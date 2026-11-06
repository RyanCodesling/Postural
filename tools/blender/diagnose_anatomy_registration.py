"""Measure skeletal registration between the pinned Z-Anatomy sources.

Run with Blender so object parenting and transforms are evaluated exactly as
they are in the authoring files::

    blender --background --factory-startup \
      --python tools/blender/diagnose_anatomy_registration.py -- \
      --z-anatomy C:\\path\\to\\Z-Anatomy\\Startup.blend \
      --z-biomechanics C:\\path\\to\\Z-Biomechanics\\Startup.blend

The diagnostic matches same-named skeletal meshes, fits an Anatomy-to-
Biomechanics similarity transform from corresponding world-space vertices,
and reports both that fit and the fixed translation used by the original
ex_001 anatomy build.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import bpy
import numpy as np


SKELETON_MATERIAL_NAMES = {
    "Bone",
    "Cartilage",
    "Teeth",
    "Anatomy_Bone_Ivory",
    "Anatomy_Cartilage",
}
ORIGINAL_FIXED_OFFSET = np.asarray((-0.000221, -0.051202, -0.077099), dtype=float)


@dataclass
class MeshSample:
    name: str
    materials: tuple[str, ...]
    vertices: np.ndarray


def parse_args() -> argparse.Namespace:
    blender_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--z-anatomy", type=Path, required=True)
    parser.add_argument("--z-biomechanics", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    return parser.parse_args(blender_args)


def is_skeleton_mesh(obj: bpy.types.Object) -> bool:
    if obj.type != "MESH" or obj.name.endswith("-line") or obj.name.endswith(".t"):
        return False
    names = {slot.name for slot in obj.data.materials if slot is not None}
    return bool(names & SKELETON_MATERIAL_NAMES)


def load_skeleton(path: Path) -> dict[str, MeshSample]:
    bpy.ops.wm.open_mainfile(filepath=str(path.resolve()))
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    result: dict[str, MeshSample] = {}
    for obj in bpy.data.objects:
        if not is_skeleton_mesh(obj):
            continue
        matrix = np.asarray(obj.matrix_world, dtype=float)
        local = np.asarray([tuple(vertex.co) for vertex in obj.data.vertices], dtype=float)
        homogeneous = np.concatenate(
            (local, np.ones((len(local), 1), dtype=float)), axis=1
        )
        world = homogeneous @ matrix.T
        result[obj.name] = MeshSample(
            name=obj.name,
            materials=tuple(
                sorted(slot.name for slot in obj.data.materials if slot is not None)
            ),
            vertices=world[:, :3],
        )
    return result


def fit_similarity(source: np.ndarray, target: np.ndarray) -> tuple[float, np.ndarray, np.ndarray]:
    """Return scale, rotation, and translation for target ~= s * R @ source + t."""

    source_center = source.mean(axis=0)
    target_center = target.mean(axis=0)
    source_zero = source - source_center
    target_zero = target - target_center
    covariance = target_zero.T @ source_zero / len(source)
    left, singular_values, right_t = np.linalg.svd(covariance)
    correction = np.eye(3)
    if np.linalg.det(left @ right_t) < 0.0:
        correction[-1, -1] = -1.0
    rotation = left @ correction @ right_t
    source_variance = float(np.mean(np.sum(source_zero * source_zero, axis=1)))
    scale = float(np.sum(singular_values * np.diag(correction)) / source_variance)
    translation = target_center - scale * (rotation @ source_center)
    return scale, rotation, translation


def transform_points(
    points: np.ndarray, scale: float, rotation: np.ndarray, translation: np.ndarray
) -> np.ndarray:
    return scale * (points @ rotation.T) + translation


def error_metrics(residual: np.ndarray) -> dict[str, float]:
    distances = np.linalg.norm(residual, axis=1)
    return {
        "rmse_m": float(np.sqrt(np.mean(distances * distances))),
        "median_m": float(np.median(distances)),
        "p95_m": float(np.percentile(distances, 95.0)),
        "max_m": float(np.max(distances)),
    }


def main() -> None:
    args = parse_args()
    anatomy = load_skeleton(args.z_anatomy)
    biomechanics = load_skeleton(args.z_biomechanics)

    common_names = sorted(set(anatomy) & set(biomechanics))
    topology_matches = [
        name
        for name in common_names
        if len(anatomy[name].vertices) == len(biomechanics[name].vertices)
    ]
    if not topology_matches:
        raise RuntimeError("The two atlases have no same-named, same-topology skeleton meshes")

    source = np.concatenate([anatomy[name].vertices for name in topology_matches], axis=0)
    target = np.concatenate(
        [biomechanics[name].vertices for name in topology_matches], axis=0
    )
    scale, rotation, translation = fit_similarity(source, target)
    fitted = transform_points(source, scale, rotation, translation)
    fixed = source + ORIGINAL_FIXED_OFFSET

    per_object = []
    for name in topology_matches:
        source_vertices = anatomy[name].vertices
        target_vertices = biomechanics[name].vertices
        source_center = source_vertices.mean(axis=0)
        target_center = target_vertices.mean(axis=0)
        fitted_center = transform_points(
            source_center[np.newaxis, :], scale, rotation, translation
        )[0]
        per_object.append(
            {
                "name": name,
                "vertices": len(source_vertices),
                "identity_center_error_m": float(
                    np.linalg.norm(source_center - target_center)
                ),
                "fitted_center_error_m": float(np.linalg.norm(fitted_center - target_center)),
                "fixed_offset_center_error_m": float(
                    np.linalg.norm(source_center + ORIGINAL_FIXED_OFFSET - target_center)
                ),
            }
        )

    worst_fitted = sorted(
        per_object, key=lambda item: item["fitted_center_error_m"], reverse=True
    )[:25]
    worst_identity = sorted(
        per_object, key=lambda item: item["identity_center_error_m"], reverse=True
    )[:25]
    shoulder_names = {
        "Clavicle.r",
        "Clavicle.l",
        "Scapula.r",
        "Scapula.l",
        "Humerus.r",
        "Humerus.l",
        "Radius.r",
        "Radius.l",
        "Ulna.r",
        "Ulna.l",
        "Sternum",
    }
    report = {
        "z_anatomy_skeleton_meshes": len(anatomy),
        "z_biomechanics_skeleton_meshes": len(biomechanics),
        "common_named_meshes": len(common_names),
        "same_topology_meshes": len(topology_matches),
        "matched_vertices": len(source),
        "fit": {
            "scale": scale,
            "rotation": rotation.tolist(),
            "translation_m": translation.tolist(),
            "errors": error_metrics(fitted - target),
        },
        "identity": {"errors": error_metrics(source - target)},
        "original_fixed_offset": {
            "translation_m": ORIGINAL_FIXED_OFFSET.tolist(),
            "errors": error_metrics(fixed - target),
        },
        "shoulder_object_centers": [
            item for item in per_object if item["name"] in shoulder_names
        ],
        "worst_fitted_object_centers": worst_fitted,
        "worst_identity_object_centers": worst_identity,
    }
    encoded = json.dumps(report, indent=2, sort_keys=True)
    print("ANATOMY_REGISTRATION_DIAGNOSTIC=" + encoded, flush=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
