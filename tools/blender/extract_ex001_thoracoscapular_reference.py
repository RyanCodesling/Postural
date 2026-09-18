"""Create the pinned biomechanics reference used by the ex_001 anatomy asset.

The source trial is the no-load right-arm abduction trial ``ABD01`` published
with the thoracoscapular shoulder model.  The script keeps only the portion of
the recording between anatomical rest and shoulder height.  It deliberately
omits the recorded overhead portion because Postural's ex_001 target is a
lateral raise to shoulder height, not full overhead abduction.

Dependencies (kept outside the web application):

    python -m pip install opensim==4.6 scipy==1.16.1

Run from the Postural repository root:

    python tools/blender/extract_ex001_thoracoscapular_reference.py

The generated JSON is small enough to review and lets Blender reproduce the
motion without requiring OpenSim at render/export time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import tempfile
import urllib.request
from dataclasses import dataclass
from io import StringIO
from pathlib import Path
from typing import Any

try:
    import numpy as np
    import opensim as osim
    from scipy.io import loadmat
    from scipy.spatial.transform import Rotation, Slerp
except ImportError as exc:  # pragma: no cover - exercised by the authoring environment
    raise SystemExit(
        "This authoring utility requires OpenSim 4.6, NumPy, and SciPy 1.16.1. "
        "Install them in a disposable Python environment before running it."
    ) from exc


SOURCE_COMMIT = "d40ebd8ba658633993e531e408c0d96df30ff367"
SOURCE_REPOSITORY = "https://github.com/ComputationalBiomechanicsLab/rmr-solver"
SOURCE_ARTICLE_DOI = "10.1371/journal.pone.0295003"
MODEL_ARTICLE_DOI = "10.3389/fnbot.2019.00090"

SOURCE_FILES = {
    "TSM_subject_noWeight.osim": {
        "url": (
            "https://raw.githubusercontent.com/ComputationalBiomechanicsLab/"
            f"rmr-solver/{SOURCE_COMMIT}/OpenSim%20Models/for%20RMR%20solver/"
            "TSM_subject_noWeight.osim"
        ),
        "sha256": "C357E61EB266558C0BFE9212462FBC1D621E0398C2EAFC4E1A4AA92FE5C7A9FF",
    },
    "ABD01.mot": {
        "url": (
            "https://raw.githubusercontent.com/ComputationalBiomechanicsLab/"
            f"rmr-solver/{SOURCE_COMMIT}/Results/IK%20solutions/ABD01.mot"
        ),
        "sha256": "1CB91D171EF55995137167B9E46EB9C352175883E0234F3DEE6D0E667037A88A",
    },
    "ABD01_activations_with_GH.mat": {
        "url": (
            "https://raw.githubusercontent.com/ComputationalBiomechanicsLab/"
            f"rmr-solver/{SOURCE_COMMIT}/Results/RMR%20analysis/100%20Hz/with%20GH/"
            "muscle_activations_Seth2019_experiment_ABD01.mat"
        ),
        "sha256": "3CF6B917B6E7BEA0BC6C6C642F14EFACAA452F4A69735DCBC9CD4919D0AA7F59",
    },
    "LICENSE_data": {
        "url": (
            "https://raw.githubusercontent.com/ComputationalBiomechanicsLab/"
            f"rmr-solver/{SOURCE_COMMIT}/LICENSE_data"
        ),
        "sha256": "4F75159F05AF4995FFFB302CA59BDBBC29AF6E1E6E309F933AC4A22D3D43AB1D",
    },
}

BODY_NAMES = ("clavicle", "scapula", "humerus", "ulna", "radius", "hand")
MUSCLE_NAMES = (
    "TrapeziusScapula_M",
    "TrapeziusScapula_S",
    "TrapeziusScapula_I",
    "TrapeziusClavicle_S",
    "SerratusAnterior_I",
    "SerratusAnterior_M",
    "SerratusAnterior_S",
    "Rhomboideus_S",
    "Rhomboideus_I",
    "LevatorScapulae",
    "Coracobrachialis",
    "DeltoideusClavicle_A",
    "DeltoideusScapula_P",
    "DeltoideusScapula_M",
    "LatissimusDorsi_S",
    "LatissimusDorsi_M",
    "LatissimusDorsi_I",
    "PectoralisMajorClavicle_S",
    "PectoralisMajorThorax_I",
    "PectoralisMajorThorax_M",
    "TeresMajor",
    "Infraspinatus_I",
    "Infraspinatus_S",
    "PectoralisMinor",
    "TeresMinor",
    "Subscapularis_S",
    "Subscapularis_M",
    "Subscapularis_I",
    "Supraspinatus_P",
    "Supraspinatus_A",
    "TRIlong",
    "BIC_long",
    "BIC_brevis",
)

# OpenSim uses X anterior, Y superior, Z right for this model.  The anatomy
# Blender source uses X subject-left, Y posterior, Z superior.
OPENSIM_THORAX_TO_BLENDER = np.array(
    (
        (0.0, 0.0, -1.0, 0.0),
        (-1.0, 0.0, 0.0, 0.0),
        (0.0, 1.0, 0.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    ),
    dtype=float,
)


@dataclass(frozen=True)
class PoseSample:
    source_time: float
    body_in_thorax: dict[str, np.ndarray]
    activations: np.ndarray
    lengths: np.ndarray
    coordinates: np.ndarray
    arm_elevation_deg: float
    arm_direction_blender: np.ndarray


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[2]
    parser.add_argument(
        "--output",
        type=Path,
        default=(
            root
            / "assets"
            / "blender"
            / "reference"
            / "ex_001_thoracoscapular_abduction.json"
        ),
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "postural-ex001-thoracoscapular",
    )
    parser.add_argument(
        "--geometry-path-output",
        type=Path,
        default=None,
        help=(
            "Optionally write a separate reviewable JSON file containing the "
            "evaluated OpenSim muscle paths at six upward-raise pose knots. "
            "Omitting this flag preserves the legacy output contract."
        ),
    )
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--rest-hold-seconds", type=float, default=0.5)
    parser.add_argument("--transition-seconds", type=float, default=0.5)
    parser.add_argument("--settle-seconds", type=float, default=0.5)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def acquire_sources(cache_dir: Path) -> dict[str, Path]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for name, metadata in SOURCE_FILES.items():
        path = cache_dir / name
        expected = str(metadata["sha256"])
        if not path.is_file() or sha256(path) != expected:
            print(f"Downloading pinned biomechanics source: {name}", flush=True)
            request = urllib.request.Request(
                str(metadata["url"]), headers={"User-Agent": "Postural-Anatomy-Authoring"}
            )
            with urllib.request.urlopen(request, timeout=120) as response:
                path.write_bytes(response.read())
        actual = sha256(path)
        if actual != expected:
            raise RuntimeError(
                f"SHA-256 mismatch for {name}: expected {expected}, found {actual}"
            )
        paths[name] = path
    return paths


def parse_motion(path: Path) -> tuple[list[str], np.ndarray]:
    lines = path.read_text(encoding="utf-8").splitlines()
    end_header = next(
        index for index, line in enumerate(lines) if line.strip().lower() == "endheader"
    )
    columns = lines[end_header + 1].split()
    values = np.loadtxt(StringIO("\n".join(lines[end_header + 2 :])))
    if values.shape != (1091, 18):
        raise RuntimeError(f"Unexpected ABD01 motion shape: {values.shape}")
    if columns[0] != "time":
        raise RuntimeError("ABD01 motion is missing its time column")
    return columns, values


def load_activations(path: Path) -> tuple[float, np.ndarray]:
    values = loadmat(
        path,
        simplify_cells=True,
        verify_compressed_data_integrity=False,
    )
    frequency = float(values["frequency_solution"])
    activations = np.asarray(values["xsol"], dtype=float)[:, : len(MUSCLE_NAMES)]
    if activations.shape != (1091, 33):
        raise RuntimeError(f"Unexpected ABD01 activation shape: {activations.shape}")
    if np.nanmin(activations) < -1e-8 or np.nanmax(activations) > 1.0 + 1e-8:
        raise RuntimeError("The source activations left the physical 0..1 interval")
    activations = np.clip(activations, 0.0, 1.0)
    return frequency, activations


def opensim_transform(frame: Any, state: Any) -> np.ndarray:
    transform = frame.getTransformInGround(state)
    matrix = np.eye(4, dtype=float)
    matrix[:3, :3] = np.array(
        [[transform.R().get(row, col) for col in range(3)] for row in range(3)]
    )
    matrix[:3, 3] = np.array([transform.p().get(index) for index in range(3)])
    return matrix


def set_model_coordinates(
    model: Any,
    state: Any,
    coordinate_names: list[str],
    coordinate_values: np.ndarray,
) -> None:
    coordinates = model.getCoordinateSet()
    value_by_name = dict(zip(coordinate_names, coordinate_values, strict=True))
    for index in range(coordinates.getSize()):
        coordinate = coordinates.get(index)
        value = float(value_by_name[coordinate.getName()])
        if int(coordinate.getMotionType()) == 1:  # Coordinate.Rotational
            value = math.radians(value)
        coordinate.setValue(state, value, False)
    model.realizePosition(state)


def interpolate_rows(times: np.ndarray, values: np.ndarray, query: float) -> np.ndarray:
    return np.array(
        [np.interp(query, times, values[:, column]) for column in range(values.shape[1])]
    )


def make_direct_sample(
    model: Any,
    state: Any,
    coordinate_names: list[str],
    source_times: np.ndarray,
    motion_coordinates: np.ndarray,
    source_activations: np.ndarray,
    source_time: float,
) -> PoseSample:
    coordinates = interpolate_rows(source_times, motion_coordinates, source_time)
    activations = interpolate_rows(source_times, source_activations, source_time)
    state.setTime(source_time)
    set_model_coordinates(model, state, coordinate_names, coordinates)

    thorax = opensim_transform(model.getBodySet().get("thorax"), state)
    thorax_inverse = np.linalg.inv(thorax)
    body_in_thorax = {
        name: thorax_inverse @ opensim_transform(model.getBodySet().get(name), state)
        for name in BODY_NAMES
    }
    lengths = np.array(
        [model.getMuscles().get(index).getLength(state) for index in range(len(MUSCLE_NAMES))]
    )

    humerus_position = opensim_transform(
        model.getBodySet().get("humerus"), state
    )[:3, 3]
    ulna_position = opensim_transform(model.getBodySet().get("ulna"), state)[:3, 3]
    humerus_vector = thorax_inverse[:3, :3] @ (ulna_position - humerus_position)
    humerus_vector /= np.linalg.norm(humerus_vector)
    arm_direction_blender = (
        OPENSIM_THORAX_TO_BLENDER[:3, :3] @ humerus_vector
    )
    arm_direction_blender /= np.linalg.norm(arm_direction_blender)
    arm_elevation = math.degrees(
        math.acos(float(np.clip(np.dot(humerus_vector, (0.0, -1.0, 0.0)), -1.0, 1.0)))
    )
    return PoseSample(
        source_time=source_time,
        body_in_thorax=body_in_thorax,
        activations=activations,
        lengths=lengths,
        coordinates=coordinates,
        arm_elevation_deg=arm_elevation,
        arm_direction_blender=arm_direction_blender,
    )


def blend_transform(first: np.ndarray, second: np.ndarray, amount: float) -> np.ndarray:
    rotations = Rotation.from_matrix(np.stack((first[:3, :3], second[:3, :3])))
    rotation = Slerp((0.0, 1.0), rotations)([amount]).as_matrix()[0]
    result = np.eye(4, dtype=float)
    result[:3, :3] = rotation
    result[:3, 3] = (1.0 - amount) * first[:3, 3] + amount * second[:3, 3]
    return result


def blend_sample(first: PoseSample, second: PoseSample, amount: float) -> PoseSample:
    blended_arm_direction = (
        (1.0 - amount) * first.arm_direction_blender
        + amount * second.arm_direction_blender
    )
    blended_arm_direction /= np.linalg.norm(blended_arm_direction)
    return PoseSample(
        source_time=(1.0 - amount) * first.source_time + amount * second.source_time,
        body_in_thorax={
            name: blend_transform(first.body_in_thorax[name], second.body_in_thorax[name], amount)
            for name in BODY_NAMES
        },
        activations=(1.0 - amount) * first.activations + amount * second.activations,
        lengths=(1.0 - amount) * first.lengths + amount * second.lengths,
        coordinates=(1.0 - amount) * first.coordinates + amount * second.coordinates,
        arm_elevation_deg=(
            (1.0 - amount) * first.arm_elevation_deg
            + amount * second.arm_elevation_deg
        ),
        arm_direction_blender=blended_arm_direction,
    )


def frame_count(seconds: float, fps: int) -> int:
    return max(1, int(round(seconds * fps)))


def linspace_excluding_first(start: float, end: float, count: int) -> np.ndarray:
    return np.linspace(start, end, count + 1, dtype=float)[1:]


def rounded_list(values: np.ndarray, digits: int = 7) -> list[float]:
    return [round(float(value), digits) for value in values]


def opensim_vec3(values: Any) -> np.ndarray:
    return np.array([values.get(index) for index in range(3)], dtype=float)


def upward_pose_knots(
    model: Any,
    state: Any,
    coordinate_names: list[str],
    source_times: np.ndarray,
    motion_coordinates: np.ndarray,
    source_activations: np.ndarray,
    source_samples: list[PoseSample],
    upward_index: int,
) -> list[tuple[str, float, PoseSample]]:
    """Resolve six deterministic pose samples on ABD01's upward branch.

    The source trial begins with the arm already slightly abducted, so the first
    knot is named ``rest`` and records its measured angle instead of pretending
    that it is anatomical zero.  Intermediate knots use the first upward
    crossing of the requested angle.  The final knot is the pinned
    shoulder-height crossing used by the legacy motion reference.
    """

    branch_angles = np.array(
        [sample.arm_elevation_deg for sample in source_samples[: upward_index + 1]],
        dtype=float,
    )
    result: list[tuple[str, float, PoseSample]] = [
        ("rest", float(branch_angles[0]), source_samples[0])
    ]
    for target in (30.0, 45.0, 60.0, 75.0):
        crossings = np.where(
            (branch_angles[:-1] <= target) & (branch_angles[1:] >= target)
        )[0]
        if crossings.size == 0:
            raise RuntimeError(
                f"ABD01 upward branch never crosses {target:.1f} degrees"
            )
        lower_index = int(crossings[0])
        lower_angle = float(branch_angles[lower_index])
        upper_angle = float(branch_angles[lower_index + 1])
        if math.isclose(lower_angle, upper_angle, abs_tol=1e-12):
            amount = 0.0
        else:
            amount = (target - lower_angle) / (upper_angle - lower_angle)
        source_time = (
            (1.0 - amount) * source_times[lower_index]
            + amount * source_times[lower_index + 1]
        )
        sample = make_direct_sample(
            model,
            state,
            coordinate_names,
            source_times,
            motion_coordinates,
            source_activations,
            float(source_time),
        )
        result.append((f"raise_{int(target):02d}", target, sample))

    peak = source_samples[upward_index]
    result.append(("shoulder_height", peak.arm_elevation_deg, peak))
    return result


def export_geometry_paths(
    output: Path,
    model: Any,
    state: Any,
    coordinate_names: list[str],
    source_times: np.ndarray,
    motion_coordinates: np.ndarray,
    source_activations: np.ndarray,
    source_samples: list[PoseSample],
    upward_index: int,
) -> dict[str, Any]:
    """Write evaluated muscle paths without changing the legacy reference.

    Every path point is evaluated from OpenSim at the requested state.  Ground
    coordinates are converted to the legacy Blender thorax frame for authoring;
    the native parent-frame location and parent-frame identity are retained for
    attachment auditing.  First and last points are labelled origin/insertion,
    while any evaluated wrapping or via points remain explicit intermediates.
    """

    poses: list[dict[str, Any]] = []
    for label, requested_angle, sample in upward_pose_knots(
        model,
        state,
        coordinate_names,
        source_times,
        motion_coordinates,
        source_activations,
        source_samples,
        upward_index,
    ):
        state.setTime(sample.source_time)
        set_model_coordinates(
            model,
            state,
            coordinate_names,
            sample.coordinates,
        )
        thorax = opensim_transform(model.getBodySet().get("thorax"), state)
        ground_to_thorax = np.linalg.inv(thorax)
        muscles: list[dict[str, Any]] = []
        for muscle_index, muscle_name in enumerate(MUSCLE_NAMES):
            muscle = model.getMuscles().get(muscle_index)
            current_path = muscle.getGeometryPath().getCurrentPath(state)
            points: list[dict[str, Any]] = []
            ground_points: list[np.ndarray] = []
            for point_index in range(current_path.getSize()):
                point = current_path.get(point_index)
                local = opensim_vec3(point.getLocation(state))
                ground = opensim_vec3(point.getLocationInGround(state))
                ground_points.append(ground)
                thorax_point = ground_to_thorax @ np.append(ground, 1.0)
                blender_point = OPENSIM_THORAX_TO_BLENDER @ thorax_point
                if point_index == 0:
                    role = "origin"
                elif point_index == current_path.getSize() - 1:
                    role = "insertion"
                else:
                    role = "via"
                parent = point.getParentFrame()
                points.append(
                    {
                        "index": point_index,
                        "role": role,
                        "name": point.getName(),
                        "parent_frame": parent.getName(),
                        "parent_frame_path": parent.getAbsolutePathString(),
                        "parent_local_m": rounded_list(local, 8),
                        "ground_m": rounded_list(ground, 8),
                        "blender_thorax_m": rounded_list(blender_point[:3], 8),
                    }
                )
            polyline_length = sum(
                float(np.linalg.norm(second - first))
                for first, second in zip(ground_points, ground_points[1:])
            )
            muscles.append(
                {
                    "name": muscle_name,
                    "path_point_count": len(points),
                    "path_length_m": round(float(muscle.getLength(state)), 8),
                    "evaluated_polyline_length_m": round(polyline_length, 8),
                    "points": points,
                }
            )
        poses.append(
            {
                "label": label,
                "requested_arm_elevation_degrees": round(requested_angle, 5),
                "evaluated_arm_elevation_degrees": round(
                    sample.arm_elevation_deg, 5
                ),
                "source_time_seconds": round(sample.source_time, 7),
                "muscles": muscles,
            }
        )

    payload = {
        "schema_version": 1,
        "exercise_id": "ex_001",
        "purpose": "V2 static anatomy attachment and path authoring reference",
        "coordinate_frames": {
            "opensim_ground": "native TSM model ground frame, metres",
            "parent_local": "native OpenSim parent PhysicalFrame, metres",
            "blender_thorax": (
                "X subject-left, Y posterior, Z superior, metres; thorax-local"
            ),
        },
        "pose_order": [pose["label"] for pose in poses],
        "muscle_names": list(MUSCLE_NAMES),
        "source": {
            "repository": SOURCE_REPOSITORY,
            "commit": SOURCE_COMMIT,
            "trial": "ABD01",
            "model": "TSM_subject_noWeight.osim",
            "source_files": SOURCE_FILES,
            "license": "CC BY 4.0",
        },
        "interpretation_boundaries": [
            "These are evaluated line-of-action and attachment references, not volumetric tissue surfaces.",
            "Origin and insertion roles follow the OpenSim path ordering; intermediate points may represent via or wrapping behavior.",
            "The rest knot preserves the published trial's measured starting elevation rather than relabelling it as zero degrees.",
            "The V2 mesh topology is authored separately and must not copy atlas or rejected muscle geometry.",
        ],
        "poses": poses,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return {
        "output": str(output.resolve()),
        "poses": len(poses),
        "muscles_per_pose": len(MUSCLE_NAMES),
        "total_evaluated_paths": len(poses) * len(MUSCLE_NAMES),
    }


def main() -> None:
    args = parse_args()
    if args.fps <= 0:
        raise ValueError("--fps must be positive")
    sources = acquire_sources(args.cache_dir.resolve())
    columns, motion = parse_motion(sources["ABD01.mot"])
    frequency, activations = load_activations(
        sources["ABD01_activations_with_GH.mat"]
    )
    source_times = motion[:, 0]
    coordinate_names = columns[1:]
    motion_coordinates = motion[:, 1:]
    if not math.isclose(frequency, 100.0, rel_tol=0.0, abs_tol=1e-9):
        raise RuntimeError(f"Unexpected source activation frequency: {frequency}")

    osim.Logger.setLevelString("Error")
    model = osim.Model(str(sources["TSM_subject_noWeight.osim"]))
    state = model.initSystem()
    model_muscles = tuple(
        model.getMuscles().get(index).getName()
        for index in range(model.getMuscles().getSize())
    )
    if model_muscles != MUSCLE_NAMES:
        raise RuntimeError("OpenSim muscle order no longer matches the pinned extraction contract")
    max_isometric_forces = [
        float(model.getMuscles().get(index).getMaxIsometricForce())
        for index in range(model.getMuscles().getSize())
    ]

    source_samples = [
        make_direct_sample(
            model,
            state,
            coordinate_names,
            source_times,
            motion_coordinates,
            activations,
            float(time_value),
        )
        for time_value in source_times
    ]
    arm_angles = np.array([sample.arm_elevation_deg for sample in source_samples])
    upward_crossings = np.where((arm_angles[:-1] < 90.0) & (arm_angles[1:] >= 90.0))[0]
    if upward_crossings.size != 1:
        raise RuntimeError(f"Expected one upward shoulder-height crossing, found {upward_crossings.size}")
    upward_index = int(upward_crossings[0] + 1)
    downward_crossings = np.where(
        (np.arange(len(arm_angles) - 1) > upward_index)
        & (arm_angles[:-1] >= 90.0)
        & (arm_angles[1:] < 90.0)
    )[0]
    if downward_crossings.size != 1:
        raise RuntimeError(
            f"Expected one downward shoulder-height crossing, found {downward_crossings.size}"
        )
    downward_index = int(downward_crossings[0] + 1)

    source_start = source_samples[0]
    upward = source_samples[upward_index]
    downward = source_samples[downward_index]
    source_end = source_samples[-1]

    timeline: list[tuple[str, PoseSample]] = []
    timeline.extend(
        ("rest", source_start)
        for _ in range(frame_count(args.rest_hold_seconds, args.fps))
    )
    for query in linspace_excluding_first(
        source_start.source_time,
        upward.source_time,
        frame_count(upward.source_time - source_start.source_time, args.fps),
    ):
        timeline.append(
            (
                "raise",
                make_direct_sample(
                    model,
                    state,
                    coordinate_names,
                    source_times,
                    motion_coordinates,
                    activations,
                    float(query),
                ),
            )
        )
    transition_count = frame_count(args.transition_seconds, args.fps)
    for index in range(1, transition_count + 1):
        timeline.append(
            (
                "shoulder_height_transition",
                blend_sample(upward, downward, index / transition_count),
            )
        )
    for query in linspace_excluding_first(
        downward.source_time,
        source_end.source_time,
        frame_count(source_end.source_time - downward.source_time, args.fps),
    ):
        timeline.append(
            (
                "lower",
                make_direct_sample(
                    model,
                    state,
                    coordinate_names,
                    source_times,
                    motion_coordinates,
                    activations,
                    float(query),
                ),
            )
        )
    settle_count = frame_count(args.settle_seconds, args.fps)
    for index in range(1, settle_count + 1):
        timeline.append(
            ("settle", blend_sample(source_end, source_start, index / settle_count))
        )

    reference_body = source_start.body_in_thorax
    reference_lengths = source_start.lengths
    conversion_inverse = np.linalg.inv(OPENSIM_THORAX_TO_BLENDER)
    frames: list[dict[str, Any]] = []
    for index, (phase, sample) in enumerate(timeline, start=1):
        deltas: dict[str, list[float]] = {}
        for body_name in BODY_NAMES:
            opensim_delta = (
                sample.body_in_thorax[body_name]
                @ np.linalg.inv(reference_body[body_name])
            )
            blender_delta = (
                OPENSIM_THORAX_TO_BLENDER
                @ opensim_delta
                @ conversion_inverse
            )
            deltas[body_name] = rounded_list(blender_delta.reshape(-1))
        frames.append(
            {
                "frame": index,
                "time_seconds": round((index - 1) / args.fps, 7),
                "phase": phase,
                "source_time_seconds": round(sample.source_time, 7),
                "right_body_deltas": deltas,
                "right_arm_elevation_degrees": round(sample.arm_elevation_deg, 5),
                "right_arm_direction": rounded_list(sample.arm_direction_blender),
                "coordinates": rounded_list(sample.coordinates, 6),
                "activations": rounded_list(sample.activations, 7),
                "length_ratios": rounded_list(sample.lengths / reference_lengths, 7),
            }
        )

    identity = np.eye(4).reshape(-1)
    for body_name in BODY_NAMES:
        final_delta = np.array(frames[-1]["right_body_deltas"][body_name])
        if not np.allclose(final_delta, identity, atol=2e-6):
            raise RuntimeError(f"Final {body_name} pose is not looped to the rest pose")
    peak_angles = [
        frame["right_arm_elevation_degrees"]
        for frame in frames
        if frame["phase"] == "shoulder_height_transition"
    ]
    if not peak_angles or min(peak_angles) < 88.0 or max(peak_angles) > 92.0:
        raise RuntimeError(
            f"Shoulder-height transition left the 88..92 degree band: {peak_angles}"
        )

    phase_first_frames: dict[str, int] = {}
    phase_last_frames: dict[str, int] = {}
    for frame in frames:
        phase_first_frames.setdefault(frame["phase"], frame["frame"])
        phase_last_frames[frame["phase"]] = frame["frame"]

    payload = {
        "schema_version": 1,
        "exercise_id": "ex_001",
        "exercise_name": "Lateral Arm Raises",
        "movement": "bilateral shoulder abduction to shoulder height",
        "fps": args.fps,
        "frame_count": len(frames),
        "duration_seconds": round(len(frames) / args.fps, 5),
        "body_names": list(BODY_NAMES),
        "muscle_names": list(MUSCLE_NAMES),
        "max_isometric_forces_newtons": rounded_list(
            np.asarray(max_isometric_forces), 4
        ),
        "coordinate_names": coordinate_names,
        "phase_first_frames": phase_first_frames,
        "phase_last_frames": phase_last_frames,
        "source": {
            "repository": SOURCE_REPOSITORY,
            "commit": SOURCE_COMMIT,
            "trial": "ABD01",
            "model": "TSM_subject_noWeight.osim",
            "activation_solution": "100 Hz RMR solution with glenohumeral stability constraint",
            "source_article_doi": SOURCE_ARTICLE_DOI,
            "model_article_doi": MODEL_ARTICLE_DOI,
            "license": "CC BY 4.0",
            "files": SOURCE_FILES,
            "source_frequency_hz": frequency,
            "upward_crossing": {
                "index": upward_index,
                "time_seconds": round(upward.source_time, 5),
                "arm_elevation_degrees": round(upward.arm_elevation_deg, 5),
            },
            "downward_crossing": {
                "index": downward_index,
                "time_seconds": round(downward.source_time, 5),
                "arm_elevation_degrees": round(downward.arm_elevation_deg, 5),
            },
        },
        "interpretation_boundaries": [
            "The right side follows one published no-load subject trial; the left side is a sagittal mirror for bilateral instruction.",
            "The overhead portion of ABD01 is omitted because ex_001 stops at shoulder height.",
            "The shoulder-height and final-settle seams are quaternion/linear interpolations, not recorded samples.",
            "Activation values are musculoskeletal-model estimates, not webcam or EMG measurements.",
            "Muscle-tendon length ratios drive an inverse-square-root, constant-volume mid-belly thickness cue; it is an instructional approximation, not subject-specific tissue deformation.",
            "This visualization is a thesis proof of concept and not a clinically validated medical device.",
        ],
        "frames": frames,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    geometry_path_summary = None
    if args.geometry_path_output is not None:
        geometry_path_summary = export_geometry_paths(
            args.geometry_path_output.resolve(),
            model,
            state,
            coordinate_names,
            source_times,
            motion_coordinates,
            activations,
            source_samples,
            upward_index,
        )
    summary = {
        "output": str(args.output.resolve()),
        "frames": len(frames),
        "duration_seconds": payload["duration_seconds"],
        "upward_crossing_frame": phase_last_frames["raise"],
        "downward_start_frame": phase_first_frames["lower"],
        "max_activation": round(float(np.max(activations)), 7),
    }
    if geometry_path_summary is not None:
        summary["geometry_paths"] = geometry_path_summary
    print("EX001_THORACOSCAPULAR_REFERENCE=" + json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
