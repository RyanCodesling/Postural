"""Independently inspect a saved MPFB figure; never rebuild or save the scene.

Checks all frames for framing, hand-axis continuity and phase-label visibility.
Optional --baseline checks unchanged authored body coordinates and shoulder
motion. Negative controls perturb only the in-memory scene, then discard it.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Quaternion, Vector
from bpy_extras.object_utils import world_to_camera_view


def body_digest(body):
    points = np.empty(len(body.data.vertices) * 3, dtype=np.float32)
    body.data.vertices.foreach_get("co", points)
    return hashlib.sha256(points.tobytes()).hexdigest()


def bounds(scene, body):
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        points = np.ones((len(mesh.vertices), 4), dtype=np.float64)
        co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", co)
        points[:, :3] = co.reshape(-1, 3)
        transform = scene.camera.matrix_world.inverted() @ evaluated.matrix_world
        camera_points = points @ np.array(transform).T
        if not len(points) or not np.isfinite(camera_points).all() or np.any(camera_points[:, 2] >= 0):
            raise RuntimeError('Empty, non-finite, or behind-camera body geometry')
        # Perspective divide using the camera's physical frame corners,
        # independently of the builder's projection-matrix implementation.
        corners = [v / abs(v.z) for v in scene.camera.data.view_frame(scene=scene)]
        left, right = min(v.x for v in corners), max(v.x for v in corners)
        bottom, top = min(v.y for v in corners), max(v.y for v in corners)
        plane = camera_points[:, :2] / -camera_points[:, 2:3]
        x = (plane[:, 0] - left) / (right - left)
        y = (plane[:, 1] - bottom) / (top - bottom)
        return {"xmin": float(x.min()), "xmax": float(x.max()),
                "ymin": float(y.min()), "ymax": float(y.max()),
                "vertices": len(mesh.vertices)}
    finally:
        evaluated.to_mesh_clear()


def hand_error(rig, side):
    fore, hand = rig.pose.bones['lowerarm_' + side], rig.pose.bones['hand_' + side]
    if min((fore.tail - fore.head).length, (hand.tail - hand.head).length) < 1e-6:
        raise RuntimeError('Degenerate forearm or hand bone')
    a, b = (fore.tail - fore.head).normalized(), (hand.tail - hand.head).normalized()
    # atan2 is stable near zero; acos of float32 dot products is not.
    return math.degrees(math.atan2(a.cross(b).length, a.dot(b)))


def shoulder_points(rig):
    return [[float(c) for c in rig.matrix_world @ p]
            for name in ['clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r']
            for p in [rig.pose.bones[name].head, rig.pose.bones[name].tail]]


def visible_phases(scene):
    return [o.data.body for o in scene.objects
            if o.type == 'FONT' and o.name.startswith('Preview phase') and not o.hide_render]


def inspect(args):
    bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
    scene = bpy.context.scene
    body, rig = scene.objects['Figure_Body'], scene.objects['Figure_Rig']
    visible_figure_meshes = [body] + [o for o in scene.objects
                                     if o.type == 'MESH' and o.get('garment_kind')]
    failures, samples, shoulder_frames = [], [], []
    digest = body_digest(body)
    report = {'source_file': args.source.name,
              'source_sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
              'revision': scene.get('figure_revision'), 'base_vertex_sha256': digest,
              'resolution': [scene.render.resolution_x, scene.render.resolution_y],
              'fps': scene.render.fps / scene.render.fps_base}
    if (scene.frame_start, scene.frame_end, report['fps']) != (1, 210, 30):
        failures.append('Changed animation duration or frame rate')
    if scene.get('figure_girdle_scale') != .475:
        failures.append('Missing or incorrect approved girdle-scale metadata')
    for frame in range(1, 211):
        scene.frame_set(frame)
        boxes = [bounds(scene, obj) for obj in visible_figure_meshes]
        box = {key: min(b[key] for b in boxes) for key in ['xmin', 'ymin']}
        box.update({key: max(b[key] for b in boxes) for key in ['xmax', 'ymax']})
        box['vertices'] = sum(b['vertices'] for b in boxes)
        errors = [hand_error(rig, s) for s in ['l', 'r']]
        if not all(math.isfinite(v) for v in [*box.values(), *errors]):
            failures.append(f'Non-finite measurement at frame {frame}')
        expected_phase = ('Ready' if frame <= 24 or frame >= 192 else
                          'Raise' if frame <= 95 else 'Pause' if frame <= 120 else 'Lower')
        phases = visible_phases(scene)
        if box['xmin'] < .06 or box['xmax'] > .94 or box['ymin'] < .035 or box['ymax'] > .88:
            failures.append(f'Framing violation at frame {frame}')
        if max(errors) > .05:
            failures.append(f'Wrist-axis discontinuity at frame {frame}')
        if phases != [expected_phase]:
            failures.append(f'Wrong phase labels at frame {frame}: {phases}')
        for obj in scene.objects:
            if obj.type == 'FONT' and not obj.hide_render:
                projected = [world_to_camera_view(scene, scene.camera, obj.matrix_world @ Vector(v))
                             for v in obj.bound_box]
                if any(p.x < .04 or p.x > .96 or p.y < .89 or p.y > .995 for p in projected):
                    failures.append(f'Text outside header at frame {frame}: {obj.name}')
        samples.append({'frame': frame, **box, 'wrist_axis_errors_deg': errors, 'phase': phases})
        shoulder_frames.append(shoulder_points(rig))

    scene.frame_set(110)
    clav = rig.pose.bones['clavicle_l']
    report['measured_peak_clavicle_elevation_deg'] = math.degrees(math.asin((clav.tail - clav.head).normalized().z))
    if abs(report['measured_peak_clavicle_elevation_deg'] - 14.40677) > .05:
        failures.append('Peak shoulder pose differs from the approved asset')
    original_lens = scene.camera.data.lens
    scene.camera.data.lens *= 1.5
    bad_box = bounds(scene, body)
    narrow_rejected = bad_box['xmin'] < .06 or bad_box['xmax'] > .94
    scene.camera.data.lens = original_lens
    hand = rig.pose.bones['hand_l']
    original_q = hand.rotation_quaternion.copy()
    hand.rotation_quaternion = original_q @ Quaternion((1, 0, 0), math.radians(15))
    bpy.context.view_layer.update()
    wrist_rejected = hand_error(rig, 'l') > .05
    hand.rotation_quaternion = original_q
    duplicate = scene.objects['Preview phase 001']
    duplicate.hide_render = False
    phase_rejected = len(visible_phases(scene)) != 1
    report['negative_controls'] = {'narrow_camera_rejected': bool(narrow_rejected),
                                   'bent_wrist_rejected': bool(wrist_rejected),
                                   'duplicate_phase_rejected': bool(phase_rejected)}
    if not all(report['negative_controls'].values()):
        failures.append('A negative control was not rejected')
    if args.baseline:
        report['baseline_sha256'] = hashlib.sha256(args.baseline.read_bytes()).hexdigest()
        bpy.ops.wm.open_mainfile(filepath=str(args.baseline.resolve()))
        baseline_body, baseline_rig = bpy.data.objects['Figure_Body'], bpy.data.objects['Figure_Rig']
        report['base_vertices_unchanged'] = body_digest(baseline_body) == digest
        delta = 0.0
        for frame in range(1, 211):
            bpy.context.scene.frame_set(frame)
            baseline = np.array(shoulder_points(baseline_rig))
            delta = max(delta, float(np.linalg.norm(baseline - np.array(shoulder_frames[frame-1]), axis=1).max()))
        report['maximum_shoulder_joint_delta_mm'] = delta * 1000
        if not report['base_vertices_unchanged'] or delta > .00001:
            failures.append('Authored body or approved shoulder motion changed')
    report['minimum_horizontal_margin'] = min(min(s['xmin'], 1-s['xmax']) for s in samples)
    report['maximum_wrist_axis_error_deg'] = max(max(s['wrist_axis_errors_deg']) for s in samples)
    report['frames_measured'] = len(samples)
    report['failures'] = failures
    report['pass'] = not failures
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({**report, 'samples': samples}, indent=2), encoding='utf-8')
    print('MPFB_INSPECTION=' + json.dumps(report), flush=True)
    if failures:
        raise RuntimeError('Saved-scene validation failed; see JSON report')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    inspect(parser.parse_args(sys.argv[sys.argv.index('--') + 1:]))
