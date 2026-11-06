r"""Author, animate, validate, render, and export the ex_001 anatomy variant.

This pipeline is deliberately separate from ``build_ex001_demo.py``.  It never
opens or overwrites Maya's editable source or her existing exports.

One-time source authoring from the vetted Z-Anatomy files:

    blender --background --factory-startup \
      --python tools/blender/build_ex001_anatomy.py -- \
      --author-source \
      --z-anatomy C:\path\to\Z-Anatomy\Startup.blend \
      --z-biomechanics C:\path\to\Z-Biomechanics\Startup.blend \
      --source-only

Normal verified build after the editable anatomy source exists:

    blender --background --factory-startup \
      --python tools/blender/build_ex001_anatomy.py -- --skip-video

The source geometry is CC BY-SA 4.0.  The kinematics and activation reference
is CC BY 4.0.  See assets/blender/THIRD_PARTY_ASSETS.md for attribution and
the exact interpretation boundaries.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Iterable

import bpy
import numpy as np
from mathutils import Matrix, Vector


EXERCISE_ID = "ex_001"
ACTION_NAME = "ex_001_lateral_arm_raise_anatomy"
SOURCE_BLEND_NAME = "ex_001_lateral_arm_raise_anatomy.blend"
RIG_NAME = "Anatomy_Armature"
ROOT_COLLECTION = "EX001_Anatomy"
RIG_COLLECTION = "EX001_Anatomy_Rig"
SKELETON_COLLECTION = "EX001_Anatomy_Skeleton"
MUSCLE_COLLECTION = "EX001_Anatomy_Muscles"
STAGE_COLLECTION = "EX001_Anatomy_Stage"

RENDER_WIDTH = 960
RENDER_HEIGHT = 540
ACTIVATION_DISPLAY_SCALE = 0.30
MAX_MODEL_LENGTH_RADIAL_DELTA = 0.225
LENGTH_SHAPE_KEY_NAME = "Model length thickness cue"
MUSCLE_INACTIVE_COLOR = (0.46, 0.035, 0.022, 1.0)
MUSCLE_ACTIVE_COLOR = (0.98, 0.16, 0.012, 1.0)
SAGITTAL_REFLECTION = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))

# The published ABD01 file is a laboratory trial, not a presentation timeline:
# it contains several seconds of near-rest preparation followed by a fast
# shoulder-height crossing.  The clinical demonstration keeps the recorded
# 3-D shoulder path but re-parameterizes it by elevation with a jerk-free
# quintic easing curve.  The result matches Maya's seven-second reference clip
# without changing the exercise target or the source shoulder geometry.
PRESENTATION_PHASE_FRAMES = {
    "rest": 24,
    "raise": 72,
    "hold": 24,
    "lower": 72,
    "settle": 18,
}

# The atlas source uses the anatomical palm-forward pose.  A lateral-raise
# demonstration instead needs the open hands to face the thighs at rest and
# remain almost palm-down at shoulder height.  These directions reproduce the
# already-validated Maya silhouette without changing the published shoulder
# path.  The distal correction is a rigid-segment presentation approximation,
# not a claim that the wrist or forearm soft tissues have been simulated.
DISTAL_HAND_REST_DIRECTION = Vector((0.045, -0.050, -1.0)).normalized()
DISTAL_HAND_PEAK_DIRECTION = Vector((1.0, -0.018, -0.025)).normalized()
EXPECTED_RIGID_SEGMENT_MESHES = {
    "upper_arm": 6,
    "radius": 64,
    "ulna": 8,
}

RIGHT_BODY_BONES = {
    "clavicle": "Clavicle-X.r",
    "scapula": "Scapula.r",
    "humerus": "RightArm",
}
LEFT_BODY_BONES = {
    "clavicle": "Clavicle-X.l",
    "scapula": "Scapula.l",
    "humerus": "LeftArm",
}

SKELETON_MATERIAL_NAMES = {"Bone", "Cartilage", "Teeth"}
EXCLUDED_MUSCLE_MATERIALS = {
    "Bursa",
    "Fascia",
    "Articular capsule",
    "Ligament",
    "Text",
}

# Atlas object base name -> one or more OpenSim activation channels.  When an
# atlas mesh combines multiple OpenSim compartments, the display cue uses a
# maximum-isometric-force-weighted mean rather than selecting the largest one.
ACTIVATION_OBJECT_MAP = {
    "Transverse part of trapezius muscle": ("TrapeziusScapula_M",),
    "Descending part of trapezius muscle": (
        "TrapeziusScapula_S",
        "TrapeziusClavicle_S",
    ),
    "Ascending part of trapezius muscle": ("TrapeziusScapula_I",),
    "Serratus anterior muscle": (
        "SerratusAnterior_I",
        "SerratusAnterior_M",
        "SerratusAnterior_S",
    ),
    "Rhomboid major muscle": ("Rhomboideus_I",),
    "Rhomboid minor muscle": ("Rhomboideus_S",),
    "Levator scapulae": ("LevatorScapulae",),
    "Coracobrachialis muscle": ("Coracobrachialis",),
    "Clavicular part of deltoid muscle": ("DeltoideusClavicle_A",),
    "Scapular spinal part of deltoid muscle": ("DeltoideusScapula_P",),
    "Acromial part of deltoid muscle": ("DeltoideusScapula_M",),
    "Latissimus dorsi muscle": (
        "LatissimusDorsi_S",
        "LatissimusDorsi_M",
        "LatissimusDorsi_I",
    ),
    "Clavicular head of pectoralis major muscle": (
        "PectoralisMajorClavicle_S",
    ),
    "Sternocostal head of pectoralis major muscle": (
        "PectoralisMajorThorax_M",
    ),
    "(Abdominal part of pectoralis major muscle)": (
        "PectoralisMajorThorax_I",
    ),
    "Teres major muscle": ("TeresMajor",),
    "Infraspinatus muscle": ("Infraspinatus_I", "Infraspinatus_S"),
    "Pectoralis minor muscle": ("PectoralisMinor",),
    "Teres minor muscle": ("TeresMinor",),
    "Subscapularis muscle": (
        "Subscapularis_S",
        "Subscapularis_M",
        "Subscapularis_I",
    ),
    "Supraspinatus muscle": ("Supraspinatus_P", "Supraspinatus_A"),
    "Long head of triceps brachii": ("TRIlong",),
    "Long head of biceps brachii": ("BIC_long",),
    "Short head of biceps brachii": ("BIC_brevis",),
}

# Base-name substring -> (proximal attachment, distal attachment, moving-weight
# exponent). ``STATIC`` is implemented through the stationary L5 bone. Values
# above 1 preserve broad origins; values below 1 keep long arm muscles moving
# with their distal segment except close to the proximal tendon.
SPANNING_RULES = (
    ("transverse part of trapezius", "STATIC", "Scapula", 2.2),
    ("ascending part of trapezius", "STATIC", "Scapula", 2.2),
    ("descending part of trapezius", "STATIC", "Clavicle", 2.2),
    ("serratus anterior", "STATIC", "Scapula", 2.0),
    ("rhomboid major", "STATIC", "Scapula", 1.8),
    ("rhomboid minor", "STATIC", "Scapula", 1.8),
    ("levator scapulae", "STATIC", "Scapula", 1.8),
    ("pectoralis minor", "STATIC", "Scapula", 2.4),
    ("acromial part of deltoid", "Scapula", "Arm", 1.15),
    ("scapular spinal part of deltoid", "Scapula", "Arm", 1.15),
    ("clavicular part of deltoid", "Clavicle", "Arm", 1.2),
    ("subscapularis", "Scapula", "Arm", 6.0),
    ("supraspinatus", "Scapula", "Arm", 6.0),
    ("infraspinatus", "Scapula", "Arm", 6.0),
    ("teres minor", "Scapula", "Arm", 5.0),
    ("teres major", "Scapula", "Arm", 5.0),
    ("coracobrachialis", "Scapula", "Arm", 0.7),
    ("long head of biceps brachii", "Scapula", "Radius", 0.55),
    ("short head of biceps brachii", "Scapula", "Radius", 0.55),
    ("long head of triceps brachii", "Scapula", "Ulna", 0.55),
    ("clavicular head of pectoralis major", "Clavicle", "Arm", 2.5),
    ("sternocostal head of pectoralis major", "STATIC", "Arm", 3.0),
    ("abdominal part of pectoralis major", "STATIC", "Arm", 3.0),
    ("latissimus dorsi", "STATIC", "Arm", 3.0),
)

# Compact glenohumeral and long-head arm muscles looked like cables when their
# complete atlas surfaces were blended between independently rotating shoulder
# segments.  They now remain cohesive with the upper arm.  This is a deliberate
# presentation approximation: the source activation/length cue still changes,
# but the mesh bulk is not advertised as a finite-element tissue simulation.
SEGMENT_STABLE_PATTERNS = (
    "acromial part of deltoid",
    "scapular spinal part of deltoid",
    "clavicular part of deltoid",
    "coracobrachialis",
    "long head of biceps brachii",
    "short head of biceps brachii",
    "long head of triceps brachii",
)

# Broad fan muscles need a narrow insertion-zone influence rather than a
# projection across the whole surface.  Projecting every vertex onto the
# origin-to-insertion line makes a large portion of the fan rotate with the
# humerus and produces anatomically implausible wing-like folds.  These radii
# are measured from the rest-pose humeral segment in metres; inside the first
# radius follows the insertion, outside the second remains with the origin.
FAN_INSERTION_RADII = {
    "clavicular head of pectoralis major": (0.062, 0.072),
    "sternocostal head of pectoralis major": (0.062, 0.072),
    "abdominal part of pectoralis major": (0.062, 0.072),
    "latissimus dorsi": (0.038, 0.060),
}


def parse_args() -> argparse.Namespace:
    blender_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--author-source", action="store_true")
    parser.add_argument("--z-anatomy", type=Path)
    parser.add_argument("--z-biomechanics", type=Path)
    parser.add_argument(
        "--source-only",
        action="store_true",
        help="Save the validated editable source without rendering or exporting.",
    )
    parser.add_argument(
        "--preview-only",
        action="store_true",
        help="Save and render the key stills, but skip GLB and video generation.",
    )
    parser.add_argument(
        "--preview-frame",
        type=int,
        help="Render one numbered QA frame and skip poster, GLB, and video output.",
    )
    parser.add_argument("--skip-video", action="store_true")
    parser.add_argument("--video-only", action="store_true")
    parser.add_argument("--export-only", action="store_true")
    parser.add_argument("--ffmpeg", type=Path)
    args = parser.parse_args(blender_args)
    exclusive = sum(
        bool(value)
        for value in (
            args.source_only,
            args.preview_only,
            args.preview_frame is not None,
            args.skip_video,
            args.video_only,
            args.export_only,
        )
    )
    if exclusive > 1:
        parser.error(
            "--source-only, --preview-only, --preview-frame, --skip-video, "
            "--video-only, and --export-only are mutually exclusive"
        )
    if args.preview_frame is not None and args.preview_frame < 1:
        parser.error("--preview-frame must be at least 1")
    if args.author_source and (args.z_anatomy is None or args.z_biomechanics is None):
        parser.error("--author-source requires --z-anatomy and --z-biomechanics")
    return args


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def source_blend_path(root: Path) -> Path:
    return root / "assets" / "blender" / SOURCE_BLEND_NAME


def reference_path(root: Path) -> Path:
    return (
        root
        / "assets"
        / "blender"
        / "reference"
        / "ex_001_thoracoscapular_abduction.json"
    )


def require_object(name: str, object_type: str | None = None) -> bpy.types.Object:
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise RuntimeError(f"Required Blender object is missing: {name}")
    if object_type is not None and obj.type != object_type:
        raise RuntimeError(f"{name} must be {object_type}, found {obj.type}")
    return obj


def load_reference(path: Path) -> dict:
    if not path.is_file():
        raise FileNotFoundError(
            f"Biomechanics reference not found: {path}. Run "
            "tools/blender/extract_ex001_thoracoscapular_reference.py first."
        )
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or payload.get("exercise_id") != EXERCISE_ID:
        raise RuntimeError("Unexpected anatomy biomechanics reference contract")
    if payload["frame_count"] != len(payload["frames"]):
        raise RuntimeError("Reference frame_count does not match its frame payload")
    return payload


def quintic_ease(fraction: float) -> float:
    """Zero-velocity, zero-acceleration easing at both phase boundaries."""

    value = max(0.0, min(1.0, fraction))
    return value * value * value * (value * (value * 6.0 - 15.0) + 10.0)


def lerp_values(first: list[float], second: list[float], amount: float) -> list[float]:
    return [
        (1.0 - amount) * float(left) + amount * float(right)
        for left, right in zip(first, second, strict=True)
    ]


def interpolate_reference_payload(first: dict, second: dict, amount: float) -> dict:
    fraction = max(0.0, min(1.0, amount))
    deltas: dict[str, list[float]] = {}
    for body_name in first["right_body_deltas"]:
        first_matrix = matrix_from_flat(first["right_body_deltas"][body_name])
        second_matrix = matrix_from_flat(second["right_body_deltas"][body_name])
        location = first_matrix.to_translation().lerp(
            second_matrix.to_translation(), fraction
        )
        rotation = first_matrix.to_quaternion().slerp(
            second_matrix.to_quaternion(), fraction
        )
        scale = first_matrix.to_scale().lerp(second_matrix.to_scale(), fraction)
        matrix = Matrix.LocRotScale(location, rotation, scale)
        deltas[body_name] = [float(value) for row in matrix for value in row]

    direction = Vector(first["right_arm_direction"]).lerp(
        Vector(second["right_arm_direction"]), fraction
    )
    if direction.length_squared < 1e-10:
        raise RuntimeError("Interpolated arm direction collapsed")
    direction.normalize()
    return {
        "source_time_seconds": (
            (1.0 - fraction) * float(first["source_time_seconds"])
            + fraction * float(second["source_time_seconds"])
        ),
        "right_body_deltas": deltas,
        "right_arm_elevation_degrees": (
            (1.0 - fraction) * float(first["right_arm_elevation_degrees"])
            + fraction * float(second["right_arm_elevation_degrees"])
        ),
        "right_arm_direction": [float(value) for value in direction],
        "coordinates": lerp_values(
            first["coordinates"], second["coordinates"], fraction
        ),
        "activations": lerp_values(
            first["activations"], second["activations"], fraction
        ),
        "length_ratios": lerp_values(
            first["length_ratios"], second["length_ratios"], fraction
        ),
    }


def elevation_envelope(
    frames: list[dict], *, ascending: bool, minimum_step: float = 0.02
) -> list[dict]:
    """Discard trial-clock plateaus while retaining the first reached pose."""

    if not frames:
        raise RuntimeError("Cannot build an elevation envelope from no frames")
    result = [frames[0]]
    last_elevation = float(frames[0]["right_arm_elevation_degrees"])
    direction = 1.0 if ascending else -1.0
    for frame in frames[1:]:
        elevation = float(frame["right_arm_elevation_degrees"])
        if direction * (elevation - last_elevation) >= minimum_step:
            result.append(frame)
            last_elevation = elevation
    if len(result) < 4:
        raise RuntimeError("Biomechanics branch did not contain a usable elevation path")
    return result


def sample_elevation_branch(
    branch: list[dict], target_elevation: float, *, ascending: bool
) -> dict:
    first_elevation = float(branch[0]["right_arm_elevation_degrees"])
    last_elevation = float(branch[-1]["right_arm_elevation_degrees"])
    if ascending:
        if target_elevation <= first_elevation:
            return interpolate_reference_payload(branch[0], branch[0], 0.0)
        if target_elevation >= last_elevation:
            return interpolate_reference_payload(branch[-1], branch[-1], 0.0)
    else:
        if target_elevation >= first_elevation:
            return interpolate_reference_payload(branch[0], branch[0], 0.0)
        if target_elevation <= last_elevation:
            return interpolate_reference_payload(branch[-1], branch[-1], 0.0)

    for first, second in zip(branch, branch[1:], strict=False):
        first_value = float(first["right_arm_elevation_degrees"])
        second_value = float(second["right_arm_elevation_degrees"])
        within = (
            first_value <= target_elevation <= second_value
            if ascending
            else second_value <= target_elevation <= first_value
        )
        if not within:
            continue
        denominator = second_value - first_value
        amount = (
            0.0
            if abs(denominator) < 1e-9
            else (target_elevation - first_value) / denominator
        )
        return interpolate_reference_payload(first, second, amount)
    raise RuntimeError(f"No biomechanics bracket for {target_elevation:.3f} degrees")


def build_presentation_reference(raw_reference: dict) -> dict:
    """Retain source 3-D poses while replacing the laboratory trial clock."""

    raw_frames = raw_reference["frames"]
    source_rest = raw_frames[0]
    upward_frames = [source_rest] + [
        frame for frame in raw_frames if frame["phase"] == "raise"
    ]
    upward_branch = elevation_envelope(upward_frames, ascending=True)
    source_peak = upward_branch[-1]
    downward_frames = [
        frame for frame in raw_frames if frame["phase"] == "lower"
    ]
    downward_branch = elevation_envelope(downward_frames, ascending=False)
    rest_elevation = float(source_rest["right_arm_elevation_degrees"])
    peak_elevation = float(source_peak["right_arm_elevation_degrees"])
    if peak_elevation - rest_elevation < 70.0:
        raise RuntimeError("Source shoulder-height branch is too short")

    presentation_frames: list[dict] = []

    def append_frame(phase: str, payload: dict) -> None:
        frame = len(presentation_frames) + 1
        result = payload
        result["frame"] = frame
        result["time_seconds"] = round(
            (frame - 1) / float(raw_reference["fps"]), 7
        )
        result["phase"] = phase
        result.setdefault(
            "activation_source_time_seconds", result["source_time_seconds"]
        )
        presentation_frames.append(result)

    for _ in range(PRESENTATION_PHASE_FRAMES["rest"]):
        append_frame(
            "rest", interpolate_reference_payload(source_rest, source_rest, 0.0)
        )

    raise_count = PRESENTATION_PHASE_FRAMES["raise"]
    for index in range(1, raise_count + 1):
        progress = quintic_ease(index / raise_count)
        target = rest_elevation + progress * (peak_elevation - rest_elevation)
        append_frame(
            "raise",
            sample_elevation_branch(upward_branch, target, ascending=True),
        )

    for _ in range(PRESENTATION_PHASE_FRAMES["hold"]):
        append_frame(
            "hold", interpolate_reference_payload(source_peak, source_peak, 0.0)
        )

    lower_count = PRESENTATION_PHASE_FRAMES["lower"]
    for index in range(1, lower_count + 1):
        phase_progress = index / lower_count
        progress = quintic_ease(phase_progress)
        target = peak_elevation - progress * (peak_elevation - rest_elevation)
        # Raising and lowering use one spatial path, avoiding the visible sweep
        # between two independently recorded shoulder-height crossings.  The
        # source lowering activation is still sampled at the matched elevation.
        payload = sample_elevation_branch(upward_branch, target, ascending=True)
        lowering_signal = sample_elevation_branch(
            downward_branch, target, ascending=False
        )
        reset = quintic_ease((phase_progress - 0.82) / 0.18)
        payload["activations"] = lerp_values(
            lowering_signal["activations"], source_rest["activations"], reset
        )
        payload["activation_source_time_seconds"] = lowering_signal[
            "source_time_seconds"
        ]
        append_frame("lower", payload)

    for _ in range(PRESENTATION_PHASE_FRAMES["settle"]):
        append_frame(
            "settle", interpolate_reference_payload(source_rest, source_rest, 0.0)
        )

    phase_first_frames: dict[str, int] = {}
    phase_last_frames: dict[str, int] = {}
    for frame in presentation_frames:
        phase = str(frame["phase"])
        phase_first_frames.setdefault(phase, int(frame["frame"]))
        phase_last_frames[phase] = int(frame["frame"])

    result = {**raw_reference}
    result["frames"] = presentation_frames
    result["frame_count"] = len(presentation_frames)
    result["duration_seconds"] = round(
        len(presentation_frames) / float(raw_reference["fps"]), 5
    )
    result["phase_first_frames"] = phase_first_frames
    result["phase_last_frames"] = phase_last_frames
    result["presentation"] = {
        "raw_reference_frames": int(raw_reference["frame_count"]),
        "phase_frames": PRESENTATION_PHASE_FRAMES,
        "timing": "quintic elevation re-parameterization of the ABD01 raise branch",
        "lowering_kinematics": "reverse of the elevation-matched raise path",
        "lowering_activation": (
            "ABD01 lowering activation matched by elevation and blended to rest "
            "over the final 18 percent"
        ),
        "peak_pose": "recorded upward shoulder-height crossing held without drift",
    }
    result["interpretation_boundaries"] = [
        *raw_reference.get("interpretation_boundaries", []),
        "The seven-second presentation is elevation-resampled and does not preserve the laboratory trial clock.",
        "Lowering reuses the raise-branch spatial path while retaining elevation-matched source lowering activation.",
    ]
    return result


def open_source(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(
            f"Editable anatomy source not found: {path}. Use --author-source once."
        )
    current = Path(bpy.data.filepath).resolve() if bpy.data.filepath else None
    if current != path.resolve():
        print(f"Opening editable anatomy source: {path}", flush=True)
        bpy.ops.wm.open_mainfile(filepath=str(path))


def unlink_from_all_collections(obj: bpy.types.Object) -> None:
    for collection in tuple(obj.users_collection):
        collection.objects.unlink(obj)


def create_collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    collection = bpy.data.collections.get(name)
    if collection is None:
        collection = bpy.data.collections.new(name)
    if collection.name not in {child.name for child in parent.children}:
        parent.children.link(collection)
    return collection


def material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float,
    metallic: float = 0.0,
) -> bpy.types.Material:
    result = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    result.use_nodes = True
    result.diffuse_color = color
    result.surface_render_method = "DITHERED" if color[3] < 1.0 else "DITHERED"
    nodes = result.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Alpha"].default_value = 1.0
    if "Specular IOR Level" in principled.inputs:
        principled.inputs["Specular IOR Level"].default_value = 0.32
    result.node_tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return result


def strip_blender_numeric_suffix(name: str) -> str:
    candidate = name
    while True:
        match = re.match(r"^(.*)\.\d{3}$", candidate)
        if match is None:
            return candidate
        candidate = match.group(1)


def is_skeleton_mesh(obj: bpy.types.Object) -> bool:
    if obj.type != "MESH" or obj.name.endswith("-line") or obj.name.endswith(".t"):
        return False
    names = {
        strip_blender_numeric_suffix(slot.name)
        for slot in obj.data.materials
        if slot is not None
    }
    return bool(names & SKELETON_MATERIAL_NAMES)


def is_anatomical_muscle_mesh(obj: bpy.types.Object) -> bool:
    if obj.type != "MESH" or obj.name.endswith(".j") or obj.name.endswith(".g"):
        return False
    names = {
        strip_blender_numeric_suffix(slot.name)
        for slot in obj.data.materials
        if slot is not None
    }
    functional = names - EXCLUDED_MUSCLE_MATERIALS
    return bool(functional) and "Bursa" not in names and "Fascia" not in names


def clear_constraints_and_pose(rig: bpy.types.Object) -> None:
    controlled_roots = {
        *RIGHT_BODY_BONES.values(),
        *LEFT_BODY_BONES.values(),
        "Clavicle-Z.r",
        "Clavicle-Z.l",
    }
    arm_roots = {"RightArm", "LeftArm"}
    for pose_bone in rig.pose.bones:
        bone = rig.data.bones[pose_bone.name]
        ancestor_names = {parent.name for parent in bone.parent_recursive}
        if pose_bone.name in controlled_roots or ancestor_names & arm_roots:
            for constraint in tuple(pose_bone.constraints):
                pose_bone.constraints.remove(constraint)
        pose_bone.matrix_basis.identity()
    rig.animation_data_clear()
    rig.data.animation_data_clear()
    bpy.context.view_layer.update()


def clinical_anatomy_materials() -> tuple[
    bpy.types.Material,
    bpy.types.Material,
    bpy.types.Material,
    bpy.types.Material,
]:
    bone = material("Anatomy_Bone_Ivory", (0.88, 0.76, 0.57, 1.0), 0.43)
    cartilage = material("Anatomy_Cartilage", (0.58, 0.77, 0.78, 1.0), 0.5)
    muscle = material("Anatomy_Muscle", (0.72, 0.075, 0.052, 1.0), 0.5)
    tendon = material("Anatomy_Tendon", (0.82, 0.69, 0.48, 1.0), 0.56)
    return bone, cartilage, muscle, tendon


def replace_object_materials(
    skeleton_objects: Iterable[bpy.types.Object],
    muscle_objects: Iterable[bpy.types.Object],
) -> None:
    bone, cartilage, muscle, tendon = clinical_anatomy_materials()
    for obj in skeleton_objects:
        if not obj.data.materials:
            obj.data.materials.append(bone)
        for index, slot in enumerate(tuple(obj.data.materials)):
            obj.data.materials[index] = (
                cartilage
                if slot and strip_blender_numeric_suffix(slot.name) == "Cartilage"
                else bone
            )
    for obj in muscle_objects:
        if not obj.data.materials:
            obj.data.materials.append(muscle)
        for index, slot in enumerate(tuple(obj.data.materials)):
            obj.data.materials[index] = (
                tendon
                if slot and strip_blender_numeric_suffix(slot.name) == "Tendon"
                else muscle
            )


def side_suffix(obj: bpy.types.Object) -> str | None:
    if obj.name.endswith(".r"):
        return "r"
    if obj.name.endswith(".l"):
        return "l"
    return None


def strip_side(name: str) -> str:
    return name[:-2] if name.endswith((".r", ".l")) else name


def has_object_ancestor(obj: bpy.types.Object, ancestor_name: str) -> bool:
    parent = obj.parent
    while parent is not None:
        if parent.name == ancestor_name:
            return True
        parent = parent.parent
    return False


def object_vertex_centroid_world(obj: bpy.types.Object) -> Vector:
    if not obj.data.vertices:
        raise RuntimeError(f"Anatomy mesh has no vertices: {obj.name}")
    return sum(
        (obj.matrix_world @ vertex.co for vertex in obj.data.vertices), Vector()
    ) / len(obj.data.vertices)


def canonical_appended_name(name: str, target_names: set[str]) -> str | None:
    """Resolve Blender's numeric suffix when an appended object name collides."""

    candidate = name
    while candidate not in target_names:
        stripped = strip_blender_numeric_suffix(candidate)
        if stripped == candidate:
            return None
        candidate = stripped
    return candidate


def derive_atlas_registration_translation(
    skeleton_objects: list[bpy.types.Object],
    reference_objects: list[bpy.types.Object],
) -> tuple[Vector, dict[str, float | int]]:
    """Register muscles from Z-Anatomy against its same-source skeleton.

    The Z-Biomechanics rig resets its render skeleton into the original
    Z-Anatomy coordinates. Matching bone-mesh centers therefore provides a
    direct cross-system check and prevents a stale source-file offset from
    being applied to the muscles after the rig has already moved.
    """

    current = {obj.name: obj for obj in skeleton_objects}
    target_names = set(current)
    deltas: list[Vector] = []
    for reference in reference_objects:
        name = canonical_appended_name(reference.name, target_names)
        if name is None:
            continue
        target = current[name]
        if len(reference.data.vertices) != len(target.data.vertices):
            continue
        deltas.append(
            object_vertex_centroid_world(target)
            - object_vertex_centroid_world(reference)
        )
    if len(deltas) < 75:
        raise RuntimeError(
            "Too few same-topology skeletal landmarks to register the atlases: "
            f"{len(deltas)}"
        )

    coordinates = np.asarray([tuple(delta) for delta in deltas], dtype=float)
    translation_values = np.median(coordinates, axis=0)
    translation_values[np.abs(translation_values) < 1e-6] = 0.0
    translation = Vector(tuple(float(value) for value in translation_values))
    residuals = np.linalg.norm(coordinates - translation_values, axis=1)
    median_error = float(np.median(residuals))
    p95_error = float(np.percentile(residuals, 95.0))
    # The pinned sources share the same BodyParts3D skeleton after the rig is
    # reset. A millimetre-scale residual would mean the authoring assumptions
    # changed and must be inspected instead of hidden by another manual nudge.
    if translation.length > 0.001 or median_error > 0.0002 or p95_error > 0.005:
        raise RuntimeError(
            "Z-Anatomy no longer registers to the reset biomechanics skeleton: "
            f"translation={translation.length:.6f} m, "
            f"median={median_error:.6f} m, p95={p95_error:.6f} m"
        )
    return translation, {
        "landmarks": len(deltas),
        "translation_m": float(translation.length),
        "median_center_error_m": median_error,
        "p95_center_error_m": p95_error,
    }


def bone_midpoint_world(rig: bpy.types.Object, bone_name: str) -> Vector:
    bone = rig.data.bones.get(bone_name)
    if bone is None:
        raise RuntimeError(f"Anatomy rig is missing bone: {bone_name}")
    return rig.matrix_world @ ((bone.head_local + bone.tail_local) * 0.5)


def bone_segment_world(
    rig: bpy.types.Object, bone_name: str
) -> tuple[Vector, Vector]:
    bone = rig.data.bones.get(bone_name)
    if bone is None:
        raise RuntimeError(f"Anatomy rig is missing bone: {bone_name}")
    return (
        rig.matrix_world @ bone.head_local,
        rig.matrix_world @ bone.tail_local,
    )


def distance_to_segment(point: Vector, start: Vector, end: Vector) -> float:
    axis = end - start
    if axis.length_squared < 1e-8:
        return (point - start).length
    fraction = max(0.0, min(1.0, (point - start).dot(axis) / axis.length_squared))
    return (point - (start + axis * fraction)).length


def side_bone(role: str, side: str) -> str:
    if role == "STATIC":
        return "L5"
    if role == "Clavicle":
        return f"Clavicle-X.{side}"
    if role == "Scapula":
        return f"Scapula.{side}"
    if role == "Arm":
        return "RightArm" if side == "r" else "LeftArm"
    if role == "Radius":
        return f"Radius.{side}"
    if role == "Ulna":
        return f"Ulna.{side}"
    raise ValueError(f"Unknown attachment role: {role}")


def medial_anchor(obj: bpy.types.Object) -> Vector:
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    count = max(4, len(points) // 12)
    medial = sorted(points, key=lambda point: abs(point.x))[:count]
    return sum(medial, Vector()) / len(medial)


def assign_two_anchor_weights(
    obj: bpy.types.Object,
    rig: bpy.types.Object,
    proximal_role: str,
    distal_role: str,
    side: str,
    moving_weight_exponent: float,
    insertion_radii: tuple[float, float] | None = None,
) -> None:
    proximal_bone = side_bone(proximal_role, side)
    distal_bone = side_bone(distal_role, side)
    proximal = (
        medial_anchor(obj)
        if proximal_role == "STATIC"
        else bone_midpoint_world(rig, proximal_bone)
    )
    distal = bone_midpoint_world(rig, distal_bone)
    distal_segment = bone_segment_world(rig, distal_bone)
    axis = distal - proximal
    denominator = axis.length_squared
    if denominator < 1e-8:
        raise RuntimeError(f"Attachment anchors collapsed for {obj.name}")

    obj.vertex_groups.clear()
    proximal_group = obj.vertex_groups.new(name=proximal_bone)
    distal_group = obj.vertex_groups.new(name=distal_bone)
    proximal_weights: list[tuple[int, float]] = []
    distal_weights: list[tuple[int, float]] = []
    for vertex in obj.data.vertices:
        point = obj.matrix_world @ vertex.co
        if insertion_radii is None:
            projected = (point - proximal).dot(axis) / denominator
            normalized = max(0.0, min(1.0, (projected - 0.08) / 0.84))
        else:
            inner_radius, outer_radius = insertion_radii
            if not 0.0 <= inner_radius < outer_radius:
                raise RuntimeError(f"Invalid insertion radii for {obj.name}")
            distance = distance_to_segment(point, *distal_segment)
            normalized = max(
                0.0,
                min(1.0, (outer_radius - distance) / (outer_radius - inner_radius)),
            )
        smooth_weight = normalized * normalized * (3.0 - 2.0 * normalized)
        moving_weight = smooth_weight**moving_weight_exponent
        proximal_weights.append((vertex.index, 1.0 - moving_weight))
        distal_weights.append((vertex.index, moving_weight))
    for index, weight in proximal_weights:
        proximal_group.add((index,), weight, "REPLACE")
    for index, weight in distal_weights:
        distal_group.add((index,), weight, "REPLACE")

    for modifier in tuple(obj.modifiers):
        if modifier.type == "ARMATURE":
            obj.modifiers.remove(modifier)
    modifier = obj.modifiers.new("Anatomical attachment deformation", "ARMATURE")
    modifier.object = rig
    # Dual-quaternion blending swings intermediate vertices through a circular
    # arc, which made shoulder attachments look like cables around the axilla.
    # Linear blending keeps the remaining small attachment zones on the direct
    # path between their anatomical segments.
    modifier.use_deform_preserve_volume = False
    obj["attachment_proximal"] = proximal_role
    obj["attachment_distal"] = distal_role
    obj["attachment_method"] = (
        "two-anchor insertion-distance skinning"
        if insertion_radii is not None
        else "two-anchor smooth skinning"
    )
    obj["moving_weight_exponent"] = moving_weight_exponent
    if insertion_radii is not None:
        obj["insertion_influence_radii_m"] = insertion_radii


def bone_parent_preserve_world(
    obj: bpy.types.Object,
    rig: bpy.types.Object,
    bone_name: str,
    attachment_method: str = (
        "rigid segment; elbow and forearm rotation fixed in source trial"
    ),
) -> None:
    world = obj.matrix_world.copy()
    for modifier in tuple(obj.modifiers):
        if modifier.type == "ARMATURE":
            obj.modifiers.remove(modifier)
    obj.vertex_groups.clear()
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = world
    obj["attachment_method"] = attachment_method
    obj["segment_bone"] = bone_name


def nearest_rigid_upper_limb_bone(
    obj: bpy.types.Object,
    rig: bpy.types.Object,
    side: str,
) -> str:
    """Choose the rigid upper-limb segment nearest the registered mesh center."""

    candidates = (
        "RightArm" if side == "r" else "LeftArm",
        f"Radius.{side}",
        f"Ulna.{side}",
    )
    center = object_vertex_centroid_world(obj)
    return min(
        candidates,
        key=lambda bone_name: distance_to_segment(
            center,
            *bone_segment_world(rig, bone_name),
        ),
    )


def rigid_segment_key(bone_name: str) -> str:
    if bone_name in {"RightArm", "LeftArm"}:
        return "upper_arm"
    if bone_name.startswith("Radius."):
        return "radius"
    if bone_name.startswith("Ulna."):
        return "ulna"
    raise ValueError(f"Unexpected rigid upper-limb segment: {bone_name}")


def repair_rigid_upper_limb_parenting(
    rig: bpy.types.Object,
    muscle_objects: list[bpy.types.Object],
) -> dict[str, int]:
    """Migrate the existing source to true rigid arm/forearm/hand segments.

    Earlier anatomy builds parented every non-spanning upper-limb surface to
    the humerus.  That kept meshes cohesive but prevented the forearm and hand
    from receiving their own presentation correction.  Rebinding in the
    cleared armature pose preserves the registered world geometry and is
    idempotent on subsequent builds.
    """

    counts = {key: 0 for key in EXPECTED_RIGID_SEGMENT_MESHES}
    repaired = 0
    for obj in muscle_objects:
        side = side_suffix(obj)
        method = str(obj.get("attachment_method", ""))
        if (
            side is None
            or not bool(obj.get("atlas_upper_limb", False))
            or not method.startswith("rigid")
        ):
            continue
        target_bone = nearest_rigid_upper_limb_bone(obj, rig, side)
        if obj.parent_type != "BONE" or obj.parent_bone != target_bone:
            bone_parent_preserve_world(
                obj,
                rig,
                target_bone,
                (
                    "rigid nearest anatomical segment; distal arm orientation "
                    "is an instructional presentation approximation"
                ),
            )
            repaired += 1
        else:
            obj["attachment_method"] = (
                "rigid nearest anatomical segment; distal arm orientation "
                "is an instructional presentation approximation"
            )
            obj["segment_bone"] = target_bone
        obj["rigid_upper_limb_segment"] = target_bone
        counts[rigid_segment_key(target_bone)] += 1

    if counts != EXPECTED_RIGID_SEGMENT_MESHES:
        raise RuntimeError(
            "Rigid upper-limb segment coverage changed: "
            f"actual={counts}, expected={EXPECTED_RIGID_SEGMENT_MESHES}"
        )

    root = bpy.data.collections[ROOT_COLLECTION]
    for key, count in counts.items():
        root[f"rigid_{key}_muscle_meshes"] = count
    root["rigid_segment_parenting_repairs"] = repaired
    binding_errors = [
        (
            object_vertex_centroid_world(obj)
            - Vector(obj["atlas_registered_center_world"])
        ).length
        for obj in muscle_objects
    ]
    root["atlas_binding_max_center_error_m"] = max(binding_errors)
    return counts


def principal_axis_length_shape(obj: bpy.types.Object) -> bool:
    if len(obj.data.vertices) < 24:
        return False
    coordinates = np.asarray([tuple(vertex.co) for vertex in obj.data.vertices], dtype=float)
    center = coordinates.mean(axis=0)
    covariance = np.cov((coordinates - center).T)
    eigenvalues, eigenvectors = np.linalg.eigh(covariance)
    axis = eigenvectors[:, int(np.argmax(eigenvalues))]
    centered = coordinates - center
    projection = centered @ axis
    span = float(np.ptp(projection))
    if span < 1e-5:
        return False
    centerline = center + np.outer(projection, axis)
    radial = coordinates - centerline
    phase = (projection - float(projection.min())) / span
    taper = np.sin(np.pi * np.clip(phase, 0.0, 1.0)) ** 2
    thick_coordinates = centerline + radial * (
        1.0 + MAX_MODEL_LENGTH_RADIAL_DELTA * taper[:, np.newaxis]
    )

    if obj.data.shape_keys is not None:
        for key in tuple(obj.data.shape_keys.key_blocks)[1:]:
            obj.shape_key_remove(key)
    if obj.data.shape_keys is None:
        obj.shape_key_add(name="Basis")
    length_cue = obj.shape_key_add(name=LENGTH_SHAPE_KEY_NAME)
    for vertex, coordinate in zip(length_cue.data, thick_coordinates, strict=True):
        vertex.co = coordinate
    length_cue.value = 0.0
    length_cue.slider_min = -1.0
    length_cue.slider_max = 1.0
    obj["length_visual"] = (
        "RMR/OpenSim muscle-tendon length ratio converted to inverse-square-root "
        "mid-belly radial scale under a constant-volume assumption"
    )
    return True


def activation_color(display: float) -> tuple[float, float, float, float]:
    fraction = max(0.0, min(1.0, display))
    return tuple(
        inactive + (active - inactive) * fraction
        for inactive, active in zip(
            MUSCLE_INACTIVE_COLOR,
            MUSCLE_ACTIVE_COLOR,
            strict=True,
        )
    )


def create_activation_material(obj: bpy.types.Object) -> bpy.types.Material:
    source = bpy.data.materials.get("Anatomy_Muscle")
    if source is None:
        raise RuntimeError("Shared clinical muscle material is missing")
    result = source.copy()
    result.name = f"Anatomy_Activation_{obj.name}"
    result.diffuse_color = MUSCLE_INACTIVE_COLOR
    principled = result.node_tree.nodes.get("Principled BSDF")
    if principled is None:
        raise RuntimeError(f"Activation material lost its Principled node: {obj.name}")
    principled.inputs["Base Color"].default_value = MUSCLE_INACTIVE_COLOR
    replaced = 0
    for index, slot in enumerate(tuple(obj.data.materials)):
        if slot is not None and slot.name == "Anatomy_Muscle":
            obj.data.materials[index] = result
            replaced += 1
    if replaced == 0:
        bpy.data.materials.remove(result)
        raise RuntimeError(f"Activation object has no muscle material slot: {obj.name}")
    obj["activation_material"] = result.name
    obj["activation_visual"] = (
        "RMR model-predicted activation divided by 0.30 and mapped linearly "
        "from clinical dark red to orange-red"
    )
    return result


def rig_muscles(
    rig: bpy.types.Object,
    muscle_objects: list[bpy.types.Object],
) -> tuple[int, int, int, int]:
    weighted = 0
    rigid = 0
    segment_stable = 0
    model_cued = 0
    spanning_names: set[str] = set()
    for obj in muscle_objects:
        side = side_suffix(obj)
        if side is None:
            continue
        lower_name = strip_side(obj.name).lower()
        base_name = strip_side(obj.name)
        if base_name in ACTIVATION_OBJECT_MAP and principal_axis_length_shape(obj):
            create_activation_material(obj)
            model_cued += 1

        if any(pattern in lower_name for pattern in SEGMENT_STABLE_PATTERNS):
            bone_parent_preserve_world(
                obj,
                rig,
                "RightArm" if side == "r" else "LeftArm",
                (
                    "segment-stable upper-arm presentation; model activation and "
                    "length cues retained"
                ),
            )
            obj["presentation_deformation_boundary"] = (
                "cohesive segment motion, not finite-element tissue deformation"
            )
            segment_stable += 1
            continue

        matched = False
        for pattern, proximal, distal, moving_weight_exponent in SPANNING_RULES:
            if pattern in lower_name:
                assign_two_anchor_weights(
                    obj,
                    rig,
                    proximal,
                    distal,
                    side,
                    moving_weight_exponent,
                    FAN_INSERTION_RADII.get(pattern),
                )
                weighted += 1
                spanning_names.add(obj.name)
                matched = True
                break
        if matched:
            continue

        if bool(obj.get("atlas_upper_limb", False)):
            segment_bone = nearest_rigid_upper_limb_bone(obj, rig, side)
            bone_parent_preserve_world(
                obj,
                rig,
                segment_bone,
                (
                    "rigid nearest anatomical segment; distal arm orientation "
                    "is an instructional presentation approximation"
                ),
            )
            obj["rigid_upper_limb_segment"] = segment_bone
            rigid += 1
    return weighted, rigid, segment_stable, model_cued


def purge_unused_loaded_data() -> None:
    for collection in tuple(bpy.data.collections):
        if collection.name not in {
            ROOT_COLLECTION,
            RIG_COLLECTION,
            SKELETON_COLLECTION,
            MUSCLE_COLLECTION,
            STAGE_COLLECTION,
        }:
            bpy.data.collections.remove(collection)
    for material_data in tuple(bpy.data.materials):
        if material_data.users == 0:
            bpy.data.materials.remove(material_data)
    for mesh in tuple(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for curve in tuple(bpy.data.curves):
        if curve.users == 0:
            bpy.data.curves.remove(curve)


def author_source(
    z_anatomy: Path,
    z_biomechanics: Path,
    output_path: Path,
) -> None:
    if not z_anatomy.is_file() or not z_biomechanics.is_file():
        raise FileNotFoundError("Both Z-Anatomy Blender sources must exist")
    print(f"Opening Z-Biomechanics rig: {z_biomechanics}", flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(z_biomechanics.resolve()))
    scene = bpy.context.scene
    rig = require_object("Armature", "ARMATURE")
    rig.name = RIG_NAME
    rig.data.name = f"{RIG_NAME}_Data"
    clear_constraints_and_pose(rig)

    skeleton_objects = [obj for obj in bpy.data.objects if is_skeleton_mesh(obj)]
    # The pinned Z-Biomechanics source contains exactly 279 rendered bone,
    # cartilage, and teeth meshes.  The remaining objects in its skeletal
    # collection are labels, guides, and controls rather than anatomy surfaces.
    if len(skeleton_objects) != 279:
        raise RuntimeError(
            "Expected 279 skeletal anatomy meshes in the pinned "
            f"Z-Biomechanics source, found {len(skeleton_objects)}"
        )

    for obj in tuple(bpy.data.objects):
        if obj is not rig and obj not in skeleton_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    for collection in tuple(bpy.data.collections):
        bpy.data.collections.remove(collection)

    root = bpy.data.collections.new(ROOT_COLLECTION)
    scene.collection.children.link(root)
    rig_collection = create_collection(RIG_COLLECTION, root)
    skeleton_collection = create_collection(SKELETON_COLLECTION, root)
    muscle_collection = create_collection(MUSCLE_COLLECTION, root)
    unlink_from_all_collections(rig)
    rig_collection.objects.link(rig)
    for obj in skeleton_objects:
        unlink_from_all_collections(obj)
        skeleton_collection.objects.link(obj)
        obj.hide_render = False
        obj.hide_set(False)

    before_objects = set(bpy.data.objects)
    print(
        f"Appending opaque muscles and registration skeleton from Z-Anatomy: {z_anatomy}",
        flush=True,
    )
    with bpy.data.libraries.load(str(z_anatomy.resolve()), link=False) as (
        data_from,
        data_to,
    ):
        if "4: Muscular system" not in data_from.collections:
            raise RuntimeError("Z-Anatomy source is missing '4: Muscular system'")
        if "1: Skeletal system" not in data_from.collections:
            raise RuntimeError("Z-Anatomy source is missing '1: Skeletal system'")
        data_to.collections = ["4: Muscular system", "1: Skeletal system"]
    loaded_muscle_collection, loaded_skeleton_collection = data_to.collections
    linked_names = {child.name for child in scene.collection.children}
    for loaded_collection in (loaded_muscle_collection, loaded_skeleton_collection):
        if loaded_collection.name not in linked_names:
            scene.collection.children.link(loaded_collection)
    bpy.context.view_layer.update()
    loaded_objects = [obj for obj in bpy.data.objects if obj not in before_objects]
    loaded_muscle_objects = set(loaded_muscle_collection.all_objects)
    muscle_objects = [
        obj
        for obj in loaded_objects
        if obj in loaded_muscle_objects and is_anatomical_muscle_mesh(obj)
    ]
    reference_skeleton_objects = [
        obj
        for obj in loaded_skeleton_collection.all_objects
        if is_skeleton_mesh(obj)
    ]
    if len(muscle_objects) != 482:
        raise RuntimeError(
            f"Expected 482 opaque muscle/tendon meshes, found {len(muscle_objects)}"
        )
    registration_translation, registration_metrics = (
        derive_atlas_registration_translation(
            skeleton_objects,
            reference_skeleton_objects,
        )
    )
    for obj in muscle_objects:
        # Preserve the atlas's anatomical classification before removing its
        # transform/group parents. This is safer than guessing a body region
        # from coordinates (the tensor fasciae latae sits near a naive arm
        # cutoff in this atlas).
        obj["atlas_upper_limb"] = has_object_ancestor(
            obj, "Muscles of upper limb.g"
        )
        source_center = object_vertex_centroid_world(obj)
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        obj.matrix_world.translation += registration_translation
        baked_transform = obj.matrix_world.copy()
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        obj.data.transform(baked_transform)
        if baked_transform.to_3x3().determinant() < 0.0:
            obj.data.flip_normals()
        obj.matrix_world = Matrix.Identity(4)
        obj["atlas_transform_baked"] = True
        obj["atlas_source_center_world"] = tuple(source_center)
        obj["atlas_registered_center_world"] = tuple(
            source_center + registration_translation
        )
        unlink_from_all_collections(obj)
        muscle_collection.objects.link(obj)
        obj.hide_render = False
        obj.hide_set(False)
        obj["source"] = "Z-Anatomy CC BY-SA 4.0"
    for obj in loaded_objects:
        if obj not in muscle_objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    replace_object_materials(skeleton_objects, muscle_objects)
    weighted, rigid, segment_stable, model_cued = rig_muscles(rig, muscle_objects)
    if weighted < 30 or rigid < 40 or segment_stable < 12 or model_cued < 35:
        raise RuntimeError(
            "Muscle rigging coverage was unexpectedly low: "
            f"weighted={weighted}, rigid={rigid}, "
            f"segment_stable={segment_stable}, model_cues={model_cued}"
        )
    root["asset_license"] = "CC BY-SA 4.0"
    root["geometry_source"] = "Z-Anatomy and BodyParts3D"
    root["atlas_registration_landmarks"] = registration_metrics["landmarks"]
    root["atlas_registration_translation_m"] = registration_metrics[
        "translation_m"
    ]
    root["atlas_registration_median_center_error_m"] = registration_metrics[
        "median_center_error_m"
    ]
    root["atlas_registration_p95_center_error_m"] = registration_metrics[
        "p95_center_error_m"
    ]
    root["muscle_mesh_count"] = len(muscle_objects)
    root["spanning_muscle_meshes"] = weighted
    root["rigid_upper_limb_muscle_meshes"] = rigid
    root["segment_stable_shoulder_muscle_meshes"] = segment_stable
    root["model_length_shape_meshes"] = model_cued
    root["activation_material_meshes"] = model_cued
    purge_unused_loaded_data()
    bpy.context.preferences.filepaths.save_version = 0
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_path))
    print(f"Authored editable anatomy source: {output_path}", flush=True)


def look_at(obj: bpy.types.Object, point: Vector) -> None:
    obj.rotation_euler = (point - obj.location).to_track_quat("-Z", "Y").to_euler()


def remove_stage() -> None:
    collection = bpy.data.collections.get(STAGE_COLLECTION)
    if collection is not None:
        for obj in tuple(collection.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(collection)


def configure_scene(scene: bpy.types.Scene, reference: dict) -> None:
    remove_stage()
    clinical_anatomy_materials()
    stage = bpy.data.collections.new(STAGE_COLLECTION)
    scene.collection.children.link(stage)

    camera_data = bpy.data.cameras.new("EX001_Anatomy_Camera_Data")
    camera = bpy.data.objects.new("EX001_Anatomy_Camera", camera_data)
    stage.objects.link(camera)
    camera.location = (0.75, -6.0, 1.10)
    camera.data.lens = 58
    camera.data.sensor_width = 36
    look_at(camera, Vector((0.0, 0.0, 0.88)))
    scene.camera = camera

    floor_material = material("Anatomy_Stage", (0.075, 0.10, 0.115, 1.0), 0.64)
    bpy.ops.mesh.primitive_plane_add(size=16.0, location=(0.0, 0.0, -0.025))
    floor = bpy.context.object
    floor.name = "EX001_Anatomy_Floor"
    unlink_from_all_collections(floor)
    stage.objects.link(floor)
    floor.data.materials.append(floor_material)
    floor_principled = floor_material.node_tree.nodes.get("Principled BSDF")
    if floor_principled is not None:
        floor_principled.inputs["Emission Color"].default_value = (
            0.075,
            0.10,
            0.115,
            1.0,
        )
        floor_principled.inputs["Emission Strength"].default_value = 0.5

    legend_material = material(
        "Anatomy_Activation_Legend",
        (0.72, 0.78, 0.80, 1.0),
        0.68,
    )
    legend_data = bpy.data.curves.new(
        "EX001_Anatomy_Activation_Legend_Data",
        type="FONT",
    )
    legend_data.body = (
        "MODEL-PREDICTED ACTIVATION   DARK RED = LOW   ORANGE = HIGH"
    )
    legend_data.align_x = "CENTER"
    legend_data.align_y = "CENTER"
    legend_data.size = 1.0
    legend = bpy.data.objects.new(
        "EX001_Anatomy_Activation_Legend",
        legend_data,
    )
    stage.objects.link(legend)
    legend.location = (0.0, -0.32, 1.84)
    legend.scale = (0.04, 0.04, 0.04)
    legend.rotation_euler = (
        camera.location - legend.location
    ).to_track_quat("Z", "Y").to_euler()
    legend.data.materials.append(legend_material)

    lights = (
        ("EX001_Anatomy_Key", "AREA", (2.4, -3.2, 3.6), 2200.0, 3.2),
        ("EX001_Anatomy_Fill", "AREA", (-3.2, -2.2, 2.1), 1650.0, 3.0),
        ("EX001_Anatomy_Rim", "AREA", (0.0, 2.4, 3.3), 1800.0, 2.5),
        ("EX001_Anatomy_Front", "AREA", (0.0, -4.0, 1.45), 1300.0, 2.8),
    )
    for name, light_type, location, energy, size in lights:
        light_data = bpy.data.lights.new(f"{name}_Data", light_type)
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        stage.objects.link(light)
        light.location = location
        look_at(light, Vector((0.0, 0.0, 0.95)))

    world = scene.world or bpy.data.worlds.new("EX001_Anatomy_World")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (
        0.025,
        0.038,
        0.045,
        1.0,
    )
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6

    scene.name = ACTION_NAME
    scene.frame_start = 1
    scene.frame_end = int(reference["frame_count"])
    scene.frame_step = 1
    scene.render.fps = int(reference["fps"])
    scene.render.fps_base = 1.0
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = RENDER_WIDTH
    scene.render.resolution_y = RENDER_HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.view_settings.exposure = 0.65
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass

    scene.timeline_markers.clear()
    labels = {
        "rest": "Anatomical rest",
        "raise": "Controlled raise",
        "hold": "Shoulder-height hold",
        "lower": "Controlled lowering",
        "settle": "Neutral finish",
    }
    for phase, frame in reference["phase_first_frames"].items():
        scene.timeline_markers.new(labels[phase], frame=int(frame))
    scene["ex001_rest_frame"] = int(reference["phase_first_frames"]["rest"])
    scene["ex001_peak_frame"] = (
        int(reference["phase_first_frames"]["hold"])
        + int(reference["phase_last_frames"]["hold"])
    ) // 2
    scene["ex001_final_frame"] = int(reference["frame_count"])
    scene["ex001_presentation_timing"] = reference["presentation"]["timing"]


def matrix_from_flat(values: list[float]) -> Matrix:
    if len(values) != 16:
        raise ValueError("Expected a flattened 4x4 transform")
    return Matrix(tuple(tuple(values[row * 4 + col] for col in range(4)) for row in range(4)))


def matrix_with_bone_direction(target_world: Matrix, desired_direction: Vector) -> Matrix:
    desired = desired_direction.normalized()
    rotation = target_world.to_quaternion()
    raw_direction = (rotation @ Vector((0.0, 1.0, 0.0))).normalized()
    correction = raw_direction.rotation_difference(desired)
    return Matrix.LocRotScale(
        target_world.to_translation(),
        correction @ rotation,
        target_world.to_scale(),
    )


def set_pose_bone_world_matrix(
    rig: bpy.types.Object,
    pose_bone: bpy.types.PoseBone,
    target_world: Matrix,
) -> None:
    pose_bone.matrix = rig.matrix_world.inverted() @ target_world
    bpy.context.view_layer.update()


def activation_indices(reference: dict, obj: bpy.types.Object) -> list[int]:
    sources = ACTIVATION_OBJECT_MAP.get(strip_side(obj.name))
    if sources is None:
        return []
    names = reference["muscle_names"]
    return [names.index(source) for source in sources]


def weighted_activation(
    reference: dict,
    frame_payload: dict,
    indices: list[int],
) -> float:
    forces = reference["max_isometric_forces_newtons"]
    numerator = sum(
        frame_payload["activations"][index] * forces[index] for index in indices
    )
    denominator = sum(forces[index] for index in indices)
    return float(numerator / denominator) if denominator else 0.0


def weighted_length_ratio(
    reference: dict,
    frame_payload: dict,
    indices: list[int],
) -> float:
    forces = reference["max_isometric_forces_newtons"]
    numerator = sum(
        frame_payload["length_ratios"][index] * forces[index] for index in indices
    )
    denominator = sum(forces[index] for index in indices)
    return float(numerator / denominator) if denominator else 1.0


def world_pose_head(rig: bpy.types.Object, bone_name: str) -> Vector:
    return rig.matrix_world @ rig.pose.bones[bone_name].head


def world_pose_tail(rig: bpy.types.Object, bone_name: str) -> Vector:
    return rig.matrix_world @ rig.pose.bones[bone_name].tail


def hand_longitudinal_direction(rig: bpy.types.Object, side: str) -> Vector:
    wrist = world_pose_head(rig, f"Proximal carpal bones-abduction.{side}")
    middle_tip = world_pose_tail(rig, f"Metacarpal bone-3rd finger.{side}")
    return (middle_tip - wrist).normalized()


def palm_dorsal_normal(rig: bpy.types.Object, side: str) -> Vector:
    """Return a consistently oriented normal from the palm toward its dorsum."""

    longitudinal = hand_longitudinal_direction(rig, side)
    across = (
        world_pose_head(rig, f"Metacarpal bone-2nd finger.{side}")
        - world_pose_head(rig, f"Metacarpal bone-5th finger.{side}")
    )
    raw = longitudinal.cross(across).normalized()
    return raw if side == "r" else -raw


def orientation_basis(longitudinal: Vector, dorsal: Vector) -> Matrix:
    longitudinal = longitudinal.normalized()
    dorsal = dorsal - longitudinal * dorsal.dot(longitudinal)
    if dorsal.length_squared < 1e-8:
        raise RuntimeError("Hand longitudinal and dorsal targets became parallel")
    dorsal.normalize()
    transverse = longitudinal.cross(dorsal).normalized()
    return Matrix(
        (
            (longitudinal.x, dorsal.x, transverse.x),
            (longitudinal.y, dorsal.y, transverse.y),
            (longitudinal.z, dorsal.z, transverse.z),
        )
    )


def distal_target_frame(side: str, progress: float) -> tuple[Vector, Vector]:
    side_sign = 1.0 if side == "l" else -1.0
    rest_direction = Vector(
        (
            DISTAL_HAND_REST_DIRECTION.x * side_sign,
            DISTAL_HAND_REST_DIRECTION.y,
            DISTAL_HAND_REST_DIRECTION.z,
        )
    )
    peak_direction = Vector(
        (
            DISTAL_HAND_PEAK_DIRECTION.x * side_sign,
            DISTAL_HAND_PEAK_DIRECTION.y,
            DISTAL_HAND_PEAK_DIRECTION.z,
        )
    )
    longitudinal = rest_direction.lerp(peak_direction, progress).normalized()
    # At rest the palm faces medially toward the thigh, so its dorsal normal
    # points laterally. At shoulder height the palm faces down and the dorsal
    # normal points up.
    dorsal = Vector((side_sign, 0.0, 0.0)).lerp(
        Vector((0.0, 0.0, 1.0)), progress
    )
    dorsal = dorsal - longitudinal * dorsal.dot(longitudinal)
    dorsal.normalize()
    return longitudinal, dorsal


def set_distal_arm_orientation(
    rig: bpy.types.Object,
    side: str,
    progress: float,
) -> None:
    """Rigidly position one forearm/hand while leaving the shoulder untouched."""

    radius_name = f"Radius.{side}"
    ulna_name = f"Ulna.{side}"
    for bone_name in (radius_name, ulna_name):
        rig.pose.bones[bone_name].matrix_basis.identity()
    bpy.context.view_layer.update()

    source_basis = orientation_basis(
        hand_longitudinal_direction(rig, side),
        palm_dorsal_normal(rig, side),
    )
    target_longitudinal, target_dorsal = distal_target_frame(side, progress)
    target_basis = orientation_basis(target_longitudinal, target_dorsal)
    delta = target_basis @ source_basis.transposed()
    delta_world = delta.to_4x4()
    for bone_name in (radius_name, ulna_name):
        pose_bone = rig.pose.bones[bone_name]
        current_world = rig.matrix_world @ pose_bone.matrix
        pivot = Matrix.Translation(rig.matrix_world @ pose_bone.head)
        set_pose_bone_world_matrix(
            rig,
            pose_bone,
            pivot @ delta_world @ pivot.inverted() @ current_world,
        )


def animate(reference: dict, rig: bpy.types.Object, muscles: list[bpy.types.Object]) -> None:
    clear_constraints_and_pose(rig)
    action = bpy.data.actions.get(ACTION_NAME)
    if action is not None and action.users == 0:
        bpy.data.actions.remove(action)
    action = bpy.data.actions.new(ACTION_NAME)
    rig.animation_data_create()
    rig.animation_data.action = action

    controlled = {**RIGHT_BODY_BONES, **{f"left_{k}": v for k, v in LEFT_BODY_BONES.items()}}
    rest_world = {
        bone_name: rig.matrix_world @ rig.pose.bones[bone_name].matrix.copy()
        for bone_name in controlled.values()
    }
    source_rest_right = Vector(reference["frames"][0]["right_arm_direction"])
    source_rest_left = SAGITTAL_REFLECTION.to_3x3() @ source_rest_right
    atlas_rest_right = bone_direction(rig, RIGHT_BODY_BONES["humerus"])
    atlas_rest_left = bone_direction(rig, LEFT_BODY_BONES["humerus"])
    right_direction_alignment = source_rest_right.rotation_difference(
        atlas_rest_right
    )
    left_direction_alignment = source_rest_left.rotation_difference(atlas_rest_left)
    rest_elevation = float(reference["frames"][0]["right_arm_elevation_degrees"])
    peak_elevation = max(
        float(frame["right_arm_elevation_degrees"])
        for frame in reference["frames"]
    )

    model_cue_objects: list[
        tuple[bpy.types.Object, list[int], bpy.types.Material]
    ] = []
    for obj in muscles:
        indices = activation_indices(reference, obj)
        if not indices or obj.data.shape_keys is None:
            continue
        key = obj.data.shape_keys.key_blocks.get(LENGTH_SHAPE_KEY_NAME)
        if key is None:
            continue
        obj.data.shape_keys.animation_data_clear()
        material_name = str(obj.get("activation_material", ""))
        activation_material = bpy.data.materials.get(material_name)
        if activation_material is None:
            raise RuntimeError(f"Activation material is missing for {obj.name}")
        activation_material.animation_data_clear()
        activation_material.node_tree.animation_data_clear()
        obj["activation_indices"] = indices
        obj["length_indices"] = indices
        model_cue_objects.append((obj, indices, activation_material))

    for frame_payload in reference["frames"]:
        frame = int(frame_payload["frame"])
        bpy.context.scene.frame_set(frame)
        deltas = frame_payload["right_body_deltas"]
        for body_name in ("clavicle", "scapula", "humerus"):
            right_bone = RIGHT_BODY_BONES[body_name]
            right_pose_bone = rig.pose.bones[right_bone]
            right_delta = matrix_from_flat(deltas[body_name])
            right_raw_target = right_delta @ rest_world[right_bone]
            right_target = Matrix.LocRotScale(
                rig.matrix_world @ right_pose_bone.head,
                right_raw_target.to_quaternion(),
                rest_world[right_bone].to_scale(),
            )
            if body_name == "humerus":
                source_direction = Vector(frame_payload["right_arm_direction"])
                right_target = matrix_with_bone_direction(
                    right_target,
                    right_direction_alignment @ source_direction,
                )
            set_pose_bone_world_matrix(
                rig,
                right_pose_bone,
                right_target,
            )
            left_bone = LEFT_BODY_BONES[body_name]
            left_pose_bone = rig.pose.bones[left_bone]
            left_delta = SAGITTAL_REFLECTION @ right_delta @ SAGITTAL_REFLECTION
            left_raw_target = left_delta @ rest_world[left_bone]
            left_target = Matrix.LocRotScale(
                rig.matrix_world @ left_pose_bone.head,
                left_raw_target.to_quaternion(),
                rest_world[left_bone].to_scale(),
            )
            if body_name == "humerus":
                source_left_direction = (
                    SAGITTAL_REFLECTION.to_3x3()
                    @ Vector(frame_payload["right_arm_direction"])
                )
                left_target = matrix_with_bone_direction(
                    left_target,
                    left_direction_alignment @ source_left_direction,
                )
            set_pose_bone_world_matrix(
                rig,
                left_pose_bone,
                left_target,
            )
        distal_progress = max(
            0.0,
            min(
                1.0,
                (
                    float(frame_payload["right_arm_elevation_degrees"])
                    - rest_elevation
                )
                / (peak_elevation - rest_elevation),
            ),
        )
        set_distal_arm_orientation(rig, "r", distal_progress)
        set_distal_arm_orientation(rig, "l", distal_progress)
        shoulder_bones = (*RIGHT_BODY_BONES.values(), *LEFT_BODY_BONES.values())
        distal_bones = ("Radius.r", "Ulna.r", "Radius.l", "Ulna.l")
        for bone_name in (*shoulder_bones, *distal_bones):
            pose_bone = rig.pose.bones[bone_name]
            pose_bone.rotation_mode = "QUATERNION"
            for data_path in ("location", "rotation_quaternion", "scale"):
                pose_bone.keyframe_insert(
                    data_path=data_path,
                    frame=frame,
                    group=(
                        "Thoracoscapular shoulder motion"
                        if bone_name in shoulder_bones
                        else "Distal arm presentation"
                    ),
                )
        for obj, indices, activation_material in model_cue_objects:
            raw = weighted_activation(reference, frame_payload, indices)
            display = max(0.0, min(1.0, raw / ACTIVATION_DISPLAY_SCALE))
            ratio = weighted_length_ratio(reference, frame_payload, indices)
            radial_scale = 1.0 / math.sqrt(max(ratio, 1e-8))
            length_value = (radial_scale - 1.0) / MAX_MODEL_LENGTH_RADIAL_DELTA
            if abs(length_value) > 1.0001:
                raise RuntimeError(
                    f"Model length cue exceeded its authored range for {obj.name}: "
                    f"ratio={ratio:.5f}, value={length_value:.5f}"
                )
            key = obj.data.shape_keys.key_blocks[LENGTH_SHAPE_KEY_NAME]
            key.value = max(-1.0, min(1.0, length_value))
            key.keyframe_insert(data_path="value", frame=frame)
            color = activation_color(display)
            activation_material.diffuse_color = color
            activation_material.keyframe_insert(data_path="diffuse_color", frame=frame)
            principled = activation_material.node_tree.nodes.get("Principled BSDF")
            if principled is None:
                raise RuntimeError(
                    f"Activation material lost its Principled node: {obj.name}"
                )
            base_color = principled.inputs["Base Color"]
            base_color.default_value = color
            base_color.keyframe_insert(data_path="default_value", frame=frame)

    for curve in getattr(action, "fcurves", ()):  # Blender 4.x compatibility
        for keyframe in curve.keyframe_points:
            keyframe.interpolation = "LINEAR"
    for obj, _, activation_material in model_cue_objects:
        shape_action = (
            obj.data.shape_keys.animation_data.action
            if obj.data.shape_keys and obj.data.shape_keys.animation_data
            else None
        )
        for curve in getattr(shape_action, "fcurves", ()):
            for keyframe in curve.keyframe_points:
                keyframe.interpolation = "LINEAR"
        material_actions = (
            activation_material.animation_data.action
            if activation_material.animation_data
            else None,
            activation_material.node_tree.animation_data.action
            if activation_material.node_tree.animation_data
            else None,
        )
        for material_action in material_actions:
            for curve in getattr(material_action, "fcurves", ()):
                for keyframe in curve.keyframe_points:
                    keyframe.interpolation = "LINEAR"

    action["exercise_id"] = EXERCISE_ID
    action["movement"] = reference["movement"]
    action["kinematics_source"] = (
        "Thoracoscapular ABD01 raise branch, elevation-resampled to shoulder height"
    )
    action["activation_source"] = "RMR with glenohumeral stability constraint"
    action["length_source"] = "OpenSim muscle-tendon length divided by rest length"
    action["activation_display"] = "0..0.30 activation mapped dark red to orange-red"
    action["length_display"] = (
        "inverse-square-root radial scale under constant-volume assumption"
    )
    action["left_side"] = "sagittal mirror of published right-side trial"
    action["presentation_timing"] = reference["presentation"]["timing"]
    action["lowering_kinematics"] = reference["presentation"][
        "lowering_kinematics"
    ]
    action["lowering_activation"] = reference["presentation"][
        "lowering_activation"
    ]
    action["humerus_direction_mapping"] = (
        "constant rest-direction alignment plus published segment direction"
    )
    action["body_translation_mapping"] = (
        "thorax fixed; connected rig joint heads preserved while published rotations drive segments"
    )
    action["distal_arm_presentation"] = (
        "rigid forearm/hand frame: palms toward thighs at rest and down at shoulder height"
    )
    action["distal_arm_boundary"] = (
        "instructional segment approximation; not finite-element soft-tissue or joint simulation"
    )
    action["clinical_status"] = "instructional thesis proof of concept; not validated clinical output"
    bpy.context.scene.frame_set(1)


def bone_direction(rig: bpy.types.Object, bone_name: str) -> Vector:
    pose_bone = rig.pose.bones[bone_name]
    return (pose_bone.tail - pose_bone.head).normalized()


def elevation_from_down(rig: bpy.types.Object, bone_name: str) -> float:
    direction = bone_direction(rig, bone_name)
    return math.degrees(math.acos(max(-1.0, min(1.0, direction.dot((0.0, 0.0, -1.0))))))


def quaternion_delta_degrees(first: Matrix, second: Matrix) -> float:
    first_rotation = first.to_quaternion()
    second_rotation = second.to_quaternion()
    return math.degrees(first_rotation.rotation_difference(second_rotation).angle)


def collection_bounds(collection: bpy.types.Collection) -> tuple[Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points: list[Vector] = []
    for obj in collection.all_objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        points.extend(evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box)
    if not points:
        raise RuntimeError("Anatomy collection has no renderable geometry")
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return minimum, maximum


def evaluated_object_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    points = [evaluated.matrix_world @ Vector(corner) for corner in evaluated.bound_box]
    minimum = Vector(tuple(min(point[index] for point in points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in points) for index in range(3)))
    return minimum, maximum


def shoulder_insertion_metrics(
    rig: bpy.types.Object,
    muscles: list[bpy.types.Object],
) -> dict[str, float | int]:
    """Measure high-weight shoulder insertions against the posed humeral axes."""

    depsgraph = bpy.context.evaluated_depsgraph_get()
    p95_distances: list[float] = []
    for obj in muscles:
        if str(obj.get("attachment_distal", "")) != "Arm":
            continue
        side = side_suffix(obj)
        if side is None:
            continue
        bone_name = "RightArm" if side == "r" else "LeftArm"
        group = obj.vertex_groups.get(bone_name)
        pose_bone = rig.pose.bones.get(bone_name)
        if group is None or pose_bone is None:
            continue
        weighted_indices = []
        for vertex in obj.data.vertices:
            weight = next(
                (
                    membership.weight
                    for membership in vertex.groups
                    if membership.group == group.index
                ),
                0.0,
            )
            if weight >= 0.8:
                weighted_indices.append(vertex.index)
        if not weighted_indices:
            continue

        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        start = rig.matrix_world @ pose_bone.head
        end = rig.matrix_world @ pose_bone.tail
        distances = np.asarray(
            [
                distance_to_segment(
                    evaluated.matrix_world @ evaluated_mesh.vertices[index].co,
                    start,
                    end,
                )
                for index in weighted_indices
            ],
            dtype=float,
        )
        evaluated.to_mesh_clear()
        p95_distances.append(float(np.percentile(distances, 95.0)))
    return {
        "muscles": len(p95_distances),
        "max_p95_m": max(p95_distances, default=float("inf")),
    }


def bounds_center_and_extent(bounds: tuple[Vector, Vector]) -> tuple[Vector, float]:
    minimum, maximum = bounds
    dimensions = maximum - minimum
    return (minimum + maximum) * 0.5, max(dimensions)


def validate(reference: dict, rig: bpy.types.Object) -> dict:
    root = bpy.data.collections.get(ROOT_COLLECTION)
    skeleton = bpy.data.collections.get(SKELETON_COLLECTION)
    muscles_collection = bpy.data.collections.get(MUSCLE_COLLECTION)
    if root is None or skeleton is None or muscles_collection is None:
        raise RuntimeError("Anatomy source collections are incomplete")
    skeleton_meshes = [obj for obj in skeleton.all_objects if obj.type == "MESH"]
    muscles = [obj for obj in muscles_collection.all_objects if obj.type == "MESH"]
    if (
        len(skeleton_meshes) != 279
        or len(muscles) != 482
        or len(rig.data.bones) != 237
    ):
        raise RuntimeError(
            "Anatomy completeness check failed: "
            f"skeleton={len(skeleton_meshes)}, muscles={len(muscles)}, bones={len(rig.data.bones)}"
        )
    expected_rigging = {
        "spanning_muscle_meshes": 34,
        "rigid_upper_limb_muscle_meshes": 78,
        "segment_stable_shoulder_muscle_meshes": 14,
        "model_length_shape_meshes": 48,
        "activation_material_meshes": 48,
        **{
            f"rigid_{key}_muscle_meshes": count
            for key, count in EXPECTED_RIGID_SEGMENT_MESHES.items()
        },
    }
    mismatched_rigging = {
        key: (root.get(key), expected)
        for key, expected in expected_rigging.items()
        if root.get(key) != expected
    }
    if mismatched_rigging:
        raise RuntimeError(f"Anatomical rig coverage changed: {mismatched_rigging}")
    registration_contract = {
        "landmarks": int(root.get("atlas_registration_landmarks", 0)),
        "translation_m": float(
            root.get("atlas_registration_translation_m", float("inf"))
        ),
        "median_center_error_m": float(
            root.get("atlas_registration_median_center_error_m", float("inf"))
        ),
        "p95_center_error_m": float(
            root.get("atlas_registration_p95_center_error_m", float("inf"))
        ),
    }
    if (
        registration_contract["landmarks"] < 75
        or registration_contract["translation_m"] > 0.001
        or registration_contract["median_center_error_m"] > 0.0002
        or registration_contract["p95_center_error_m"] > 0.005
    ):
        raise RuntimeError(
            "The stored Z-Anatomy-to-skeleton registration contract failed: "
            f"{registration_contract}"
        )
    if any(not bool(obj.get("atlas_transform_baked", False)) for obj in muscles):
        raise RuntimeError("Every atlas muscle mesh must use baked positive-space geometry")
    if any("atlas_registered_center_world" not in obj for obj in muscles):
        raise RuntimeError("Every muscle mesh must retain its registered atlas center")
    if any(
        material_data.diffuse_color[3] < 0.999
        for material_data in bpy.data.materials
        if material_data.users
    ):
        raise RuntimeError("The clinical anatomy variant must remain fully opaque")

    rest_frame = 1
    peak_frame = (
        int(reference["phase_first_frames"]["hold"])
        + int(reference["phase_last_frames"]["hold"])
    ) // 2
    final_frame = int(reference["frame_count"])
    bpy.context.scene.frame_set(rest_frame)
    max_base_registration_error = float(
        root.get("atlas_binding_max_center_error_m", float("inf"))
    )
    rest_shoulder_insertions = shoulder_insertion_metrics(rig, muscles)
    rest_right = elevation_from_down(rig, "RightArm")
    rest_left = elevation_from_down(rig, "LeftArm")
    rest_scapula = rig.matrix_world @ rig.pose.bones["Scapula.r"].matrix.copy()
    rest_clavicle = rig.matrix_world @ rig.pose.bones["Clavicle-X.r"].matrix.copy()
    rest_right_direction = bone_direction(rig, "RightArm")
    rest_left_direction = bone_direction(rig, "LeftArm")
    rest_hand_directions = {
        side: hand_longitudinal_direction(rig, side) for side in ("r", "l")
    }
    rest_palm_dorsals = {
        side: palm_dorsal_normal(rig, side) for side in ("r", "l")
    }
    rest_wrist_positions = {
        side: world_pose_head(rig, f"Proximal carpal bones-abduction.{side}")
        for side in ("r", "l")
    }
    rest_distal_targets = {
        side: distal_target_frame(side, 0.0) for side in ("r", "l")
    }
    rest_muscle_extents = {
        obj.name: bounds_center_and_extent(evaluated_object_bounds(obj))[1]
        for obj in muscles
    }
    minimum, maximum = collection_bounds(root)
    stature = maximum.z - minimum.z

    bpy.context.scene.frame_set(peak_frame)
    peak_shoulder_insertions = shoulder_insertion_metrics(rig, muscles)
    peak_right = elevation_from_down(rig, "RightArm")
    peak_left = elevation_from_down(rig, "LeftArm")
    peak_scapula = rig.matrix_world @ rig.pose.bones["Scapula.r"].matrix.copy()
    peak_clavicle = rig.matrix_world @ rig.pose.bones["Clavicle-X.r"].matrix.copy()
    right_direction = bone_direction(rig, "RightArm")
    left_direction = bone_direction(rig, "LeftArm")
    peak_hand_directions = {
        side: hand_longitudinal_direction(rig, side) for side in ("r", "l")
    }
    peak_palm_dorsals = {
        side: palm_dorsal_normal(rig, side) for side in ("r", "l")
    }
    peak_distal_targets = {
        side: distal_target_frame(side, 1.0) for side in ("r", "l")
    }
    mirrored_right = Vector((-right_direction.x, right_direction.y, right_direction.z))
    symmetry_error = (mirrored_right - left_direction).length
    scapula_motion = quaternion_delta_degrees(rest_scapula, peak_scapula)
    clavicle_motion = quaternion_delta_degrees(rest_clavicle, peak_clavicle)
    source_rest_direction = Vector(reference["frames"][0]["right_arm_direction"])
    source_peak_direction = Vector(
        reference["frames"][peak_frame - 1]["right_arm_direction"]
    )
    expected_right_direction = (
        source_rest_direction.rotation_difference(rest_right_direction)
        @ source_peak_direction
    ).normalized()
    source_rest_left = SAGITTAL_REFLECTION.to_3x3() @ source_rest_direction
    source_peak_left = SAGITTAL_REFLECTION.to_3x3() @ source_peak_direction
    expected_left_direction = (
        source_rest_left.rotation_difference(rest_left_direction)
        @ source_peak_left
    ).normalized()
    direction_tracking_error = max(
        math.degrees(right_direction.angle(expected_right_direction)),
        math.degrees(left_direction.angle(expected_left_direction)),
    )

    peak_bounds = {obj.name: evaluated_object_bounds(obj) for obj in muscles}
    peak_centers_and_extents = {
        name: bounds_center_and_extent(bounds) for name, bounds in peak_bounds.items()
    }
    max_muscle_extent = max(extent for _, extent in peak_centers_and_extents.values())
    max_extent_growth = max(
        extent / max(rest_muscle_extents[name], 1e-8)
        for name, (_, extent) in peak_centers_and_extents.items()
    )
    paired_center_errors: list[float] = []
    for obj in muscles:
        if not obj.name.endswith(".r"):
            continue
        left_name = obj.name[:-2] + ".l"
        if left_name not in peak_centers_and_extents:
            continue
        right_center = peak_centers_and_extents[obj.name][0]
        left_center = peak_centers_and_extents[left_name][0]
        paired_center_errors.append(
            (Vector((-right_center.x, right_center.y, right_center.z)) - left_center).length
        )
    max_muscle_mirror_error = max(paired_center_errors, default=0.0)
    peak_minimum, peak_maximum = collection_bounds(root)
    right_head = rig.matrix_world @ rig.pose.bones["RightArm"].head
    left_head = rig.matrix_world @ rig.pose.bones["LeftArm"].head

    if max(rest_left, rest_right) > 16.0:
        raise RuntimeError(f"Rest arms are not anatomical: {rest_left:.2f}, {rest_right:.2f}")
    if max_base_registration_error > 0.00001:
        raise RuntimeError(
            "A muscle base mesh no longer occupies its registered atlas coordinates: "
            f"{max_base_registration_error:.8f} m"
        )
    if (
        rest_shoulder_insertions["muscles"] != 8
        or peak_shoulder_insertions["muscles"] != 8
        or rest_shoulder_insertions["max_p95_m"] > 0.07
        or peak_shoulder_insertions["max_p95_m"] > 0.07
    ):
        raise RuntimeError(
            "Shoulder muscle insertions detached from the humeral axes: "
            f"rest={rest_shoulder_insertions}, peak={peak_shoulder_insertions}"
        )
    if not 86.0 <= peak_left <= 94.0 or not 86.0 <= peak_right <= 94.0:
        raise RuntimeError(
            f"Shoulder-height pose left the 86..94 degree band: {peak_left:.2f}, {peak_right:.2f}"
        )
    if symmetry_error > 0.035:
        raise RuntimeError(f"Bilateral mirror error is too high: {symmetry_error:.5f}")
    if direction_tracking_error > 0.05:
        raise RuntimeError(
            "Humerus direction left the elevation-resampled reference path by "
            f"{direction_tracking_error:.4f} degrees"
        )
    rest_hand_direction_error = max(
        math.degrees(
            rest_hand_directions[side].angle(rest_distal_targets[side][0])
        )
        for side in ("r", "l")
    )
    rest_palm_error = max(
        math.degrees(rest_palm_dorsals[side].angle(rest_distal_targets[side][1]))
        for side in ("r", "l")
    )
    peak_hand_direction_error = max(
        math.degrees(
            peak_hand_directions[side].angle(peak_distal_targets[side][0])
        )
        for side in ("r", "l")
    )
    peak_palm_error = max(
        math.degrees(peak_palm_dorsals[side].angle(peak_distal_targets[side][1]))
        for side in ("r", "l")
    )
    if max(
        rest_hand_direction_error,
        rest_palm_error,
        peak_hand_direction_error,
        peak_palm_error,
    ) > 0.1:
        raise RuntimeError(
            "The distal arm pose left its instructional hand targets: "
            f"rest_hand={rest_hand_direction_error:.4f}, "
            f"rest_palm={rest_palm_error:.4f}, "
            f"peak_hand={peak_hand_direction_error:.4f}, "
            f"peak_palm={peak_palm_error:.4f} degrees"
        )
    if (
        right_head.x >= 0.0
        or left_head.x <= 0.0
        or min(right_head.z, left_head.z) < 1.30
        or max(abs(right_head.x), abs(left_head.x)) > 0.25
    ):
        raise RuntimeError(
            "The humeral heads detached from the shoulder girdle: "
            f"right={tuple(round(value, 4) for value in right_head)}, "
            f"left={tuple(round(value, 4) for value in left_head)}"
        )
    if max_muscle_mirror_error > 0.012:
        raise RuntimeError(
            f"Paired muscle surfaces lost bilateral symmetry: {max_muscle_mirror_error:.5f} m"
        )
    if max_muscle_extent > 0.70 or max_extent_growth > 3.0:
        raise RuntimeError(
            "A muscle surface stretched beyond the deformation envelope: "
            f"extent={max_muscle_extent:.3f} m, growth={max_extent_growth:.3f}x"
        )
    if (
        max(abs(peak_minimum.x), abs(peak_maximum.x)) > 1.15
        or peak_minimum.z < minimum.z - 0.015
        or peak_maximum.z > maximum.z + 0.05
    ):
        raise RuntimeError(
            "Animated anatomy left the plausible body envelope: "
            f"min={tuple(round(value, 3) for value in peak_minimum)}, "
            f"max={tuple(round(value, 3) for value in peak_maximum)}"
        )
    if scapula_motion < 15.0 or clavicle_motion < 5.0:
        raise RuntimeError(
            f"Shoulder-girdle motion is missing: scapula={scapula_motion:.2f}, clavicle={clavicle_motion:.2f}"
        )
    if not 1.60 <= stature <= 1.90:
        raise RuntimeError(f"Anatomical model stature is implausible: {stature:.3f} m")

    model_cue_meshes = [
        obj
        for obj in muscles
        if obj.data.shape_keys
        and LENGTH_SHAPE_KEY_NAME in obj.data.shape_keys.key_blocks
    ]
    if len(model_cue_meshes) != 48:
        raise RuntimeError(
            f"Only {len(model_cue_meshes)} muscle meshes carry model length cues"
        )
    peak_length_values = [
        obj.data.shape_keys.key_blocks[LENGTH_SHAPE_KEY_NAME].value
        for obj in model_cue_meshes
    ]
    if max(abs(value) for value in peak_length_values) < 0.1:
        raise RuntimeError("Model-derived muscle length cues are not animated")
    peak_payload = reference["frames"][peak_frame - 1]
    activation_errors = []
    length_errors = []
    for obj in model_cue_meshes:
        indices = list(obj.get("activation_indices", []))
        expected_raw = weighted_activation(reference, peak_payload, indices)
        expected_display = max(
            0.0, min(1.0, expected_raw / ACTIVATION_DISPLAY_SCALE)
        )
        material_name = str(obj.get("activation_material", ""))
        activation_material = bpy.data.materials.get(material_name)
        if activation_material is None:
            raise RuntimeError(f"Activation material is missing for {obj.name}")
        expected_color = activation_color(expected_display)
        activation_errors.extend(
            abs(actual - expected)
            for actual, expected in zip(
                activation_material.diffuse_color,
                expected_color,
                strict=True,
            )
        )
        expected_ratio = weighted_length_ratio(reference, peak_payload, indices)
        expected_length_value = (
            1.0 / math.sqrt(max(expected_ratio, 1e-8)) - 1.0
        ) / MAX_MODEL_LENGTH_RADIAL_DELTA
        actual_length_value = obj.data.shape_keys.key_blocks[
            LENGTH_SHAPE_KEY_NAME
        ].value
        length_errors.append(abs(actual_length_value - expected_length_value))
    max_activation_error = max(activation_errors, default=0.0)
    max_length_error = max(length_errors, default=0.0)
    if max_activation_error > 1e-5:
        raise RuntimeError(
            f"An activation color diverged from the RMR data: {max_activation_error:.7f}"
        )
    if max_length_error > 1e-5:
        raise RuntimeError(
            f"A thickness cue diverged from model length data: {max_length_error:.7f}"
        )

    # Audit the entire sampled kinematic path, not only the poster pose.  This
    # catches a correct-looking peak that reaches it through a discontinuity,
    # detaches a humeral head between phases, or loses left/right symmetry.
    max_path_tracking_error = 0.0
    max_path_mirror_error = 0.0
    max_arm_step = 0.0
    max_hand_direction_tracking_error = 0.0
    max_palm_tracking_error = 0.0
    max_hand_mirror_error = 0.0
    max_palm_mirror_error = 0.0
    max_hand_step = 0.0
    max_wrist_step = 0.0
    path_humeral_head_min_height = float("inf")
    previous_right_direction: Vector | None = None
    previous_right_hand: Vector | None = None
    previous_right_wrist: Vector | None = None
    right_alignment = source_rest_direction.rotation_difference(rest_right_direction)
    left_alignment = source_rest_left.rotation_difference(rest_left_direction)
    source_rest_elevation = float(
        reference["frames"][0]["right_arm_elevation_degrees"]
    )
    source_peak_elevation = max(
        float(frame["right_arm_elevation_degrees"])
        for frame in reference["frames"]
    )
    for frame_payload in reference["frames"]:
        frame = int(frame_payload["frame"])
        bpy.context.scene.frame_set(frame)
        current_right = bone_direction(rig, "RightArm")
        current_left = bone_direction(rig, "LeftArm")
        source_right = Vector(frame_payload["right_arm_direction"])
        source_left = SAGITTAL_REFLECTION.to_3x3() @ source_right
        expected_right = (right_alignment @ source_right).normalized()
        expected_left = (left_alignment @ source_left).normalized()
        max_path_tracking_error = max(
            max_path_tracking_error,
            math.degrees(current_right.angle(expected_right)),
            math.degrees(current_left.angle(expected_left)),
        )
        max_path_mirror_error = max(
            max_path_mirror_error,
            (
                Vector((-current_right.x, current_right.y, current_right.z))
                - current_left
            ).length,
        )
        progress = max(
            0.0,
            min(
                1.0,
                (
                    float(frame_payload["right_arm_elevation_degrees"])
                    - source_rest_elevation
                )
                / (source_peak_elevation - source_rest_elevation),
            ),
        )
        current_hands = {
            side: hand_longitudinal_direction(rig, side) for side in ("r", "l")
        }
        current_dorsals = {
            side: palm_dorsal_normal(rig, side) for side in ("r", "l")
        }
        distal_targets = {
            side: distal_target_frame(side, progress) for side in ("r", "l")
        }
        max_hand_direction_tracking_error = max(
            max_hand_direction_tracking_error,
            *(
                math.degrees(current_hands[side].angle(distal_targets[side][0]))
                for side in ("r", "l")
            ),
        )
        max_palm_tracking_error = max(
            max_palm_tracking_error,
            *(
                math.degrees(current_dorsals[side].angle(distal_targets[side][1]))
                for side in ("r", "l")
            ),
        )
        max_hand_mirror_error = max(
            max_hand_mirror_error,
            (
                Vector(
                    (
                        -current_hands["r"].x,
                        current_hands["r"].y,
                        current_hands["r"].z,
                    )
                )
                - current_hands["l"]
            ).length,
        )
        max_palm_mirror_error = max(
            max_palm_mirror_error,
            (
                Vector(
                    (
                        -current_dorsals["r"].x,
                        current_dorsals["r"].y,
                        current_dorsals["r"].z,
                    )
                )
                - current_dorsals["l"]
            ).length,
        )
        current_right_wrist = world_pose_head(
            rig, "Proximal carpal bones-abduction.r"
        )
        if previous_right_direction is not None:
            max_arm_step = max(
                max_arm_step,
                math.degrees(previous_right_direction.angle(current_right)),
            )
        if previous_right_hand is not None and previous_right_wrist is not None:
            max_hand_step = max(
                max_hand_step,
                math.degrees(previous_right_hand.angle(current_hands["r"])),
            )
            max_wrist_step = max(
                max_wrist_step,
                (current_right_wrist - previous_right_wrist).length,
            )
        previous_right_direction = current_right
        previous_right_hand = current_hands["r"]
        previous_right_wrist = current_right_wrist
        current_right_head = rig.matrix_world @ rig.pose.bones["RightArm"].head
        current_left_head = rig.matrix_world @ rig.pose.bones["LeftArm"].head
        path_humeral_head_min_height = min(
            path_humeral_head_min_height,
            current_right_head.z,
            current_left_head.z,
        )
        if (
            current_right_head.x >= 0.0
            or current_left_head.x <= 0.0
            or max(abs(current_right_head.x), abs(current_left_head.x)) > 0.25
        ):
            raise RuntimeError(
                f"A humeral head detached at frame {frame}: "
                f"right={tuple(round(value, 4) for value in current_right_head)}, "
                f"left={tuple(round(value, 4) for value in current_left_head)}"
            )
    if max_path_tracking_error > 0.05:
        raise RuntimeError(
            "The animated humeri left the elevation-resampled reference path: "
            f"{max_path_tracking_error:.4f} degrees"
        )
    if max_path_mirror_error > 0.035:
        raise RuntimeError(
            f"Bilateral symmetry failed along the path: {max_path_mirror_error:.5f}"
        )
    if max(max_hand_direction_tracking_error, max_palm_tracking_error) > 0.1:
        raise RuntimeError(
            "The distal arm left its elevation-driven orientation path: "
            f"hand={max_hand_direction_tracking_error:.4f}, "
            f"palm={max_palm_tracking_error:.4f} degrees"
        )
    if max(max_hand_mirror_error, max_palm_mirror_error) > 0.035:
        raise RuntimeError(
            "The distal arm lost bilateral symmetry: "
            f"hand={max_hand_mirror_error:.5f}, palm={max_palm_mirror_error:.5f}"
        )
    if max_hand_step > 6.0 or max_wrist_step > 0.04:
        raise RuntimeError(
            "The distal arm path contains a discontinuity: "
            f"hand={max_hand_step:.3f} degrees/frame, "
            f"wrist={max_wrist_step:.4f} m/frame"
        )
    if max_arm_step > 6.0:
        raise RuntimeError(
            f"The arm path contains a discontinuity: {max_arm_step:.3f} degrees/frame"
        )
    if path_humeral_head_min_height < 1.30:
        raise RuntimeError(
            "A humeral head fell below the shoulder girdle along the path: "
            f"{path_humeral_head_min_height:.4f} m"
        )

    phase_payloads = {
        phase: [
            frame for frame in reference["frames"] if frame["phase"] == phase
        ]
        for phase in PRESENTATION_PHASE_FRAMES
    }
    phase_counts = {
        phase: len(frames) for phase, frames in phase_payloads.items()
    }
    if phase_counts != PRESENTATION_PHASE_FRAMES:
        raise RuntimeError(
            f"Presentation phase contract changed: {phase_counts}"
        )
    raise_angles = [
        float(frame["right_arm_elevation_degrees"])
        for frame in phase_payloads["raise"]
    ]
    lower_angles = [
        float(frame["right_arm_elevation_degrees"])
        for frame in phase_payloads["lower"]
    ]
    max_raise_reversal = max(
        (first - second for first, second in zip(raise_angles, raise_angles[1:])),
        default=0.0,
    )
    max_lower_reversal = max(
        (second - first for first, second in zip(lower_angles, lower_angles[1:])),
        default=0.0,
    )
    if max_raise_reversal > 0.05 or max_lower_reversal > 0.05:
        raise RuntimeError(
            "Presentation elevation reversed inside a movement phase: "
            f"raise={max_raise_reversal:.4f}, lower={max_lower_reversal:.4f}"
        )
    raise_quarter_gain = raise_angles[len(raise_angles) // 4] - rest_right
    if raise_quarter_gain < 5.0:
        raise RuntimeError(
            "The presentation retained the source trial's near-rest dead time: "
            f"quarter-gain={raise_quarter_gain:.3f} degrees"
        )
    hold_directions = [
        Vector(frame["right_arm_direction"])
        for frame in phase_payloads["hold"]
    ]
    hold_direction_drift = max(
        (
            math.degrees(hold_directions[0].angle(direction))
            for direction in hold_directions[1:]
        ),
        default=0.0,
    )
    if hold_direction_drift > 0.1:
        raise RuntimeError(
            f"The shoulder-height hold drifted by {hold_direction_drift:.4f} degrees"
        )
    presentation_angles = [
        float(frame["right_arm_elevation_degrees"])
        for frame in reference["frames"]
    ]
    max_angular_velocity = max(
        abs(second - first) * float(reference["fps"])
        for first, second in zip(presentation_angles, presentation_angles[1:])
    )
    if max_angular_velocity > 75.0:
        raise RuntimeError(
            "The controlled presentation is too abrupt: "
            f"{max_angular_velocity:.2f} degrees/second"
        )

    dynamic_muscles = [
        obj
        for obj in muscles
        if str(obj.get("attachment_method", "static")) != "static"
    ]
    phase_first = reference["phase_first_frames"]
    phase_last = reference["phase_last_frames"]
    seam_pairs = (
        (int(phase_last["rest"]), int(phase_first["raise"])),
        (
            int(phase_last["raise"]),
            int(phase_first["hold"]),
        ),
        (
            int(phase_last["hold"]),
            int(phase_first["lower"]),
        ),
        (int(phase_last["lower"]), int(phase_first["settle"])),
    )
    deformation_frames = sorted(
        {
            *preview_frames(reference),
            *(frame for pair in seam_pairs for frame in pair),
        }
    )
    centers_by_frame: dict[int, dict[str, Vector]] = {}
    max_sampled_dynamic_extent = 0.0
    max_sampled_dynamic_growth = 0.0
    max_sampled_muscle_mirror_error = 0.0
    max_sampled_activation_error = 0.0
    max_sampled_length_error = 0.0
    for frame in deformation_frames:
        bpy.context.scene.frame_set(frame)
        centers: dict[str, Vector] = {}
        extents: dict[str, float] = {}
        for obj in dynamic_muscles:
            center, extent = bounds_center_and_extent(evaluated_object_bounds(obj))
            centers[obj.name] = center
            extents[obj.name] = extent
            max_sampled_dynamic_extent = max(max_sampled_dynamic_extent, extent)
            max_sampled_dynamic_growth = max(
                max_sampled_dynamic_growth,
                extent / max(rest_muscle_extents[obj.name], 1e-8),
            )
        centers_by_frame[frame] = centers
        for obj in dynamic_muscles:
            if not obj.name.endswith(".r"):
                continue
            left_name = obj.name[:-2] + ".l"
            if left_name not in centers:
                continue
            mirrored_center = Vector(
                (-centers[obj.name].x, centers[obj.name].y, centers[obj.name].z)
            )
            max_sampled_muscle_mirror_error = max(
                max_sampled_muscle_mirror_error,
                (mirrored_center - centers[left_name]).length,
            )
        frame_payload = reference["frames"][frame - 1]
        for obj in model_cue_meshes:
            indices = list(obj.get("activation_indices", []))
            expected_raw = weighted_activation(
                reference,
                frame_payload,
                indices,
            )
            expected_display = max(
                0.0, min(1.0, expected_raw / ACTIVATION_DISPLAY_SCALE)
            )
            material_name = str(obj.get("activation_material", ""))
            activation_material = bpy.data.materials.get(material_name)
            if activation_material is None:
                raise RuntimeError(f"Activation material is missing for {obj.name}")
            expected_color = activation_color(expected_display)
            max_sampled_activation_error = max(
                max_sampled_activation_error,
                *(
                    abs(actual - expected)
                    for actual, expected in zip(
                        activation_material.diffuse_color,
                        expected_color,
                        strict=True,
                    )
                ),
            )
            expected_ratio = weighted_length_ratio(reference, frame_payload, indices)
            expected_length_value = (
                1.0 / math.sqrt(max(expected_ratio, 1e-8)) - 1.0
            ) / MAX_MODEL_LENGTH_RADIAL_DELTA
            actual_length_value = obj.data.shape_keys.key_blocks[
                LENGTH_SHAPE_KEY_NAME
            ].value
            max_sampled_length_error = max(
                max_sampled_length_error,
                abs(actual_length_value - expected_length_value),
            )
    max_surface_seam_step = max(
        (
            centers_by_frame[second][name] - centers_by_frame[first][name]
        ).length
        for first, second in seam_pairs
        for name in centers_by_frame[first]
    )
    if max_sampled_dynamic_extent > 0.70 or max_sampled_dynamic_growth > 3.0:
        raise RuntimeError(
            "A moving muscle left its deformation envelope between key poses: "
            f"extent={max_sampled_dynamic_extent:.3f} m, "
            f"growth={max_sampled_dynamic_growth:.3f}x"
        )
    if max_sampled_muscle_mirror_error > 0.012:
        raise RuntimeError(
            "A paired moving muscle lost symmetry between key poses: "
            f"{max_sampled_muscle_mirror_error:.5f} m"
        )
    if max_surface_seam_step > 0.04:
        raise RuntimeError(
            "A moving muscle jumped across an animation phase boundary: "
            f"{max_surface_seam_step:.4f} m/frame"
        )
    if max_sampled_activation_error > 1e-5:
        raise RuntimeError(
            "A sampled activation color diverged from RMR activation data: "
            f"{max_sampled_activation_error:.7f}"
        )
    if max_sampled_length_error > 1e-5:
        raise RuntimeError(
            "A sampled thickness cue diverged from model length data: "
            f"{max_sampled_length_error:.7f}"
        )

    bpy.context.scene.frame_set(final_frame)
    final_right = elevation_from_down(rig, "RightArm")
    final_hand_direction_error = max(
        math.degrees(
            hand_longitudinal_direction(rig, side).angle(
                rest_hand_directions[side]
            )
        )
        for side in ("r", "l")
    )
    final_palm_error = max(
        math.degrees(palm_dorsal_normal(rig, side).angle(rest_palm_dorsals[side]))
        for side in ("r", "l")
    )
    final_wrist_error = max(
        (
            world_pose_head(rig, f"Proximal carpal bones-abduction.{side}")
            - rest_wrist_positions[side]
        ).length
        for side in ("r", "l")
    )
    if (
        abs(final_right - rest_right) > 0.2
        or final_hand_direction_error > 0.1
        or final_palm_error > 0.1
        or final_wrist_error > 0.001
    ):
        raise RuntimeError("The anatomy animation does not settle back to rest")

    metrics = {
        "action": ACTION_NAME,
        "frames": int(reference["frame_count"]),
        "duration_seconds": reference["duration_seconds"],
        "rig_bones": len(rig.data.bones),
        "skeleton_meshes": len(skeleton_meshes),
        "muscle_meshes": len(muscles),
        "muscle_vertices": sum(len(obj.data.vertices) for obj in muscles),
        "atlas_registration_landmarks": registration_contract["landmarks"],
        "atlas_registration_translation_m": round(
            registration_contract["translation_m"], 8
        ),
        "atlas_registration_median_center_error_m": round(
            registration_contract["median_center_error_m"], 8
        ),
        "atlas_registration_p95_center_error_m": round(
            registration_contract["p95_center_error_m"], 8
        ),
        "max_base_registration_error_m": round(max_base_registration_error, 8),
        "rigid_segment_meshes": {
            key: int(root[f"rigid_{key}_muscle_meshes"])
            for key in EXPECTED_RIGID_SEGMENT_MESHES
        },
        "rest_shoulder_insertion_max_p95_m": round(
            rest_shoulder_insertions["max_p95_m"], 6
        ),
        "peak_shoulder_insertion_max_p95_m": round(
            peak_shoulder_insertions["max_p95_m"], 6
        ),
        "model_cue_meshes": len(model_cue_meshes),
        "activation_material_meshes": len(model_cue_meshes),
        "rest_left_deg": round(rest_left, 2),
        "rest_right_deg": round(rest_right, 2),
        "peak_left_deg": round(peak_left, 2),
        "peak_right_deg": round(peak_right, 2),
        "scapula_motion_deg": round(scapula_motion, 2),
        "clavicle_motion_deg": round(clavicle_motion, 2),
        "mirror_direction_error": round(symmetry_error, 6),
        "direction_tracking_error_deg": round(direction_tracking_error, 6),
        "max_path_tracking_error_deg": round(max_path_tracking_error, 6),
        "max_path_mirror_error": round(max_path_mirror_error, 6),
        "max_arm_step_deg_per_frame": round(max_arm_step, 4),
        "rest_hand_direction_error_deg": round(rest_hand_direction_error, 6),
        "rest_palm_target_error_deg": round(rest_palm_error, 6),
        "peak_hand_direction_error_deg": round(peak_hand_direction_error, 6),
        "peak_palm_target_error_deg": round(peak_palm_error, 6),
        "max_hand_direction_tracking_error_deg": round(
            max_hand_direction_tracking_error, 6
        ),
        "max_palm_tracking_error_deg": round(max_palm_tracking_error, 6),
        "max_hand_mirror_error": round(max_hand_mirror_error, 6),
        "max_palm_mirror_error": round(max_palm_mirror_error, 6),
        "max_hand_step_deg_per_frame": round(max_hand_step, 4),
        "max_wrist_step_m_per_frame": round(max_wrist_step, 6),
        "final_hand_direction_error_deg": round(final_hand_direction_error, 6),
        "final_palm_error_deg": round(final_palm_error, 6),
        "final_wrist_error_m": round(final_wrist_error, 8),
        "phase_frames": phase_counts,
        "raise_quarter_gain_deg": round(raise_quarter_gain, 4),
        "hold_direction_drift_deg": round(hold_direction_drift, 6),
        "max_presentation_velocity_deg_s": round(max_angular_velocity, 3),
        "humeral_head_min_height_m": round(min(right_head.z, left_head.z), 4),
        "path_humeral_head_min_height_m": round(path_humeral_head_min_height, 4),
        "max_muscle_extent_m": round(max_muscle_extent, 4),
        "max_muscle_extent_growth": round(max_extent_growth, 4),
        "max_muscle_mirror_error_m": round(max_muscle_mirror_error, 6),
        "max_sampled_dynamic_extent_m": round(max_sampled_dynamic_extent, 4),
        "max_sampled_dynamic_growth": round(max_sampled_dynamic_growth, 4),
        "max_sampled_muscle_mirror_error_m": round(
            max_sampled_muscle_mirror_error, 6
        ),
        "max_surface_seam_step_m": round(max_surface_seam_step, 6),
        "max_activation_display_error": round(max_activation_error, 7),
        "max_sampled_activation_error": round(max_sampled_activation_error, 7),
        "max_length_display_error": round(max_length_error, 7),
        "max_sampled_length_error": round(max_sampled_length_error, 7),
        "stature_m": round(stature, 3),
        "opaque": True,
    }
    print("EX001_ANATOMY_VALIDATION=" + json.dumps(metrics, sort_keys=True), flush=True)
    bpy.context.scene.frame_set(1)
    return metrics


def save_source(path: Path) -> None:
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


def export_glb(
    reference: dict,
    rig: bpy.types.Object,
    output_path: Path,
) -> None:
    root = bpy.data.collections[ROOT_COLLECTION]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in root.all_objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.context.scene.frame_set(1)
    print(f"Exporting animated anatomy GLB: {output_path}", flush=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_animation_mode="SCENE",
        export_pointer_animation=True,
        export_convert_animation_pointer=False,
        export_anim_scene_split_object=False,
        export_frame_range=True,
        export_force_sampling=False,
        export_optimize_animation_size=True,
        export_apply=False,
        export_materials="EXPORT",
        export_morph=True,
        export_morph_normal=False,
        export_morph_tangent=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_generic_quantization=12,
        export_yup=True,
    )


def render_still(scene: bpy.types.Scene, frame: int, path: Path) -> None:
    started = time.perf_counter()
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.frame_set(frame)
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    print(f"Rendering anatomy frame {frame}: {path}", flush=True)
    bpy.ops.render.render(write_still=True)
    print(f"Rendered frame {frame} in {time.perf_counter() - started:.1f}s", flush=True)


def resolve_ffmpeg(explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit is not None:
        candidates.append(explicit.expanduser())
    match = shutil.which("ffmpeg")
    if match:
        candidates.append(Path(match))
    if sys.platform == "win32":
        candidates.extend(
            (
                Path(r"C:\Program Files\Jellyfin\Server\ffmpeg.exe"),
                Path(r"C:\Program Files\ffmpeg\bin\ffmpeg.exe"),
            )
        )
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.is_file():
            return resolved
    raise FileNotFoundError("FFmpeg was not found; pass --ffmpeg explicitly")


def render_sequence(scene: bpy.types.Scene, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    # Workbench keeps the dense million-vertex anatomy legible while making the
    # complete seven-second presentation practical to reproduce. The editable
    # source and poster still retain the configured EEVEE scene.
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "WORLD"
    scene.display.shading.show_specular_highlight = True
    scene.frame_step = 1
    scene.frame_set(scene.frame_start)
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output_dir / "frame_")
    bpy.ops.render.render(animation=True)
    expected_frames = scene.frame_end - scene.frame_start + 1
    rendered_frames = len(tuple(output_dir.glob("frame_*.png")))
    if rendered_frames != expected_frames:
        raise RuntimeError(
            "Anatomy sequence render is incomplete: "
            f"expected={expected_frames}, rendered={rendered_frames}"
        )
    return output_dir / "frame_%04d.png"


def encode(
    ffmpeg: Path,
    pattern: Path,
    output: Path,
    scene: bpy.types.Scene,
    codec: tuple[str, ...],
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    command = (
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        str(scene.render.fps),
        "-start_number",
        str(scene.frame_start),
        "-i",
        str(pattern),
        "-frames:v",
        str(scene.frame_end - scene.frame_start + 1),
        "-an",
        *codec,
        str(output),
    )
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())


def render_videos(
    scene: bpy.types.Scene,
    ffmpeg: Path,
    public_dir: Path,
) -> tuple[Path, Path]:
    webm = public_dir / "ex_001-lateral-arm-raise-anatomy.webm"
    mp4 = public_dir / "ex_001-lateral-arm-raise-anatomy.mp4"
    with tempfile.TemporaryDirectory(prefix="postural_ex001_anatomy_frames_") as temp:
        pattern = render_sequence(scene, Path(temp))
        encode(
            ffmpeg,
            pattern,
            webm,
            scene,
            ("-c:v", "libvpx-vp9", "-crf", "31", "-b:v", "0", "-pix_fmt", "yuv420p", "-row-mt", "1"),
        )
        encode(
            ffmpeg,
            pattern,
            mp4,
            scene,
            (
                "-vf",
                "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=0x0E1214",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "22",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
            ),
        )
    return webm, mp4


def preview_frames(reference: dict) -> tuple[int, int, int, int, int]:
    first = 1
    hold_first = int(reference["phase_first_frames"]["hold"])
    hold_last = int(reference["phase_last_frames"]["hold"])

    def closest_in_phase(phase: str, target_degrees: float) -> int:
        candidates = [
            frame for frame in reference["frames"] if frame["phase"] == phase
        ]
        if not candidates:
            raise RuntimeError(f"Reference contains no {phase} frames")
        return int(
            min(
                candidates,
                key=lambda frame: abs(
                    float(frame["right_arm_elevation_degrees"])
                    - target_degrees
                ),
            )["frame"]
        )

    return (
        first,
        closest_in_phase("raise", 50.0),
        (hold_first + hold_last) // 2,
        closest_in_phase("lower", 50.0),
        int(reference["frame_count"]),
    )


def main() -> None:
    args = parse_args()
    root = repo_root()
    blend_path = source_blend_path(root)
    raw_reference = load_reference(reference_path(root))
    reference = build_presentation_reference(raw_reference)
    if args.author_source:
        author_source(
            args.z_anatomy.resolve(),
            args.z_biomechanics.resolve(),
            blend_path,
        )
    else:
        open_source(blend_path)

    scene = bpy.context.scene
    rig = require_object(RIG_NAME, "ARMATURE")
    muscles_collection = bpy.data.collections.get(MUSCLE_COLLECTION)
    if muscles_collection is None:
        raise RuntimeError(f"Required collection is missing: {MUSCLE_COLLECTION}")
    muscles = [obj for obj in muscles_collection.all_objects if obj.type == "MESH"]
    configure_scene(scene, reference)
    clear_constraints_and_pose(rig)
    scene.frame_set(1)
    repair_rigid_upper_limb_parenting(rig, muscles)
    animate(reference, rig, muscles)
    validate(reference, rig)

    preview_dir = root / "assets" / "blender" / "previews" / "ex_001_anatomy"
    public_dir = root / "web" / "public" / "demos"
    glb_path = public_dir / "ex_001-lateral-arm-raise-anatomy.glb"
    poster_path = public_dir / "ex_001-lateral-arm-raise-anatomy-poster.png"
    if args.preview_frame is not None and args.preview_frame > int(reference["frame_count"]):
        raise RuntimeError(
            f"--preview-frame {args.preview_frame} exceeds the {reference['frame_count']}-frame timeline"
        )
    frames = (
        (args.preview_frame,)
        if args.preview_frame is not None
        else preview_frames(reference)
    )
    poster_frame = frames[2] if len(frames) >= 3 else frames[0]
    outputs: list[Path] = []

    if not args.video_only and not args.export_only:
        save_source(blend_path)
        outputs.append(blend_path)
    if not args.source_only and not args.video_only and not args.export_only:
        for frame in frames:
            render_still(
                scene,
                frame,
                preview_dir / f"ex_001_anatomy_frame_{frame:04d}.png",
            )
        if args.preview_frame is None:
            shutil.copyfile(
                preview_dir / f"ex_001_anatomy_frame_{poster_frame:04d}.png",
                poster_path,
            )
            outputs.append(poster_path)
    if args.export_only or (
        not args.source_only
        and not args.preview_only
        and args.preview_frame is None
        and not args.video_only
    ):
        export_glb(reference, rig, glb_path)
        outputs.append(glb_path)
    if not any(
        (
            args.source_only,
            args.preview_only,
            args.preview_frame is not None,
            args.skip_video,
            args.export_only,
        )
    ):
        outputs.extend(render_videos(scene, resolve_ffmpeg(args.ffmpeg), public_dir))

    scene.frame_set(1)
    print("EX001_ANATOMY_OUTPUTS", flush=True)
    for output in outputs:
        print(output, flush=True)
    print(
        f"EX001_ANATOMY_DURATION_SECONDS={reference['duration_seconds']:.5f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
