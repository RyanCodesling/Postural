"""Author the ex_001 patient-facing demonstration figure from scratch.

This builds an original neutral articulated mannequin - geometry, rig and
animation are all generated here. It shares nothing with the Maya demo or with
the Z-Anatomy atlas, so it carries no third-party asset licence.

The design follows what ex_001 actually scores. `trunkLean`, `scapularElevation`
and `shoulderSymmetry` are all read off the shoulder yoke, the trunk axis and
the pelvis line, so the figure wears nothing that could occlude them, and the
acromions and pelvis carry deliberate landmark markers.

Stages, so progress can be inspected between them:
    --stage geometry   base body only
    --stage rig        + armature and skinning
    --stage animate    + the 210-frame action
    --stage full       + materials, studio and camera (default)
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

STATURE = 1.750
FRAME_START, FRAME_END, FPS = 1, 210, 30

# Joint centres for a figure standing at rest, arms down. Radii are elliptical
# (across, deep): a human torso is wider than it is deep, and a skin modifier
# with equal radii gives a barrel.
# (name, x, y, z, r_across, r_deep)
JOINTS = [
    ("pelvis",     0.000, 0.000, 0.955, 0.132, 0.100),
    ("waist",      0.000, 0.000, 1.090, 0.104, 0.086),
    ("chest",      0.000, 0.000, 1.300, 0.146, 0.108),
    ("yoke",       0.000, 0.000, 1.432, 0.112, 0.094),
    ("neck",       0.000, 0.000, 1.512, 0.047, 0.049),
    ("head",       0.000, 0.000, 1.606, 0.090, 0.102),
    ("skull",      0.000, 0.000, 1.706, 0.068, 0.074),
]
LIMB = {
    "clav":     (0.092, 0.000, 1.434, 0.060, 0.062),
    "shoulder": (0.203, 0.000, 1.430, 0.064, 0.066),
    "elbow":    (0.219, 0.000, 1.146, 0.045, 0.046),
    "wrist":    (0.232, 0.000, 0.858, 0.030, 0.033),
    "hand":     (0.236, -0.012, 0.734, 0.042, 0.025),
    "hip":      (0.098, 0.000, 0.930, 0.084, 0.082),
    "knee":     (0.108, 0.000, 0.496, 0.055, 0.057),
    "ankle":    (0.108, 0.000, 0.082, 0.038, 0.042),
    "toe":      (0.108, -0.112, 0.034, 0.044, 0.032),
}
SPINE_EDGES = [("pelvis", "waist"), ("waist", "chest"), ("chest", "yoke"),
               ("yoke", "neck"), ("neck", "head"), ("head", "skull")]
# The arm branches off a narrow clavicle, not off the wide chest: branching
# straight from the chest fuses the whole upper arm into the torso.
ARM_EDGES = [("yoke", "clav"), ("clav", "shoulder"), ("shoulder", "elbow"),
             ("elbow", "wrist"), ("wrist", "hand")]
LEG_EDGES = [("pelvis", "hip"), ("hip", "knee"), ("knee", "ankle"),
             ("ankle", "toe")]

# Detail ladder. Each variant is the same skeleton and the same movement; what
# changes is how much of a body is wrapped around it.
#   radius      limb/torso thickness multiplier
#   joint_balls sphere at each major joint, as a multiple of the local radius
#   ball_accent balls in the landmark colour rather than the body colour
#   muscles     extra swelling joints (deltoid, quadriceps, calf) in the chain
#   landmarks   acromion bands, trunk-axis stripe, pelvis band
VARIANTS = {
    "diagram":     dict(radius=0.42, joint_balls=1.85, ball_accent=True,
                        muscles=False, landmarks=False),
    "mannequin":   dict(radius=1.00, joint_balls=0.00, ball_accent=False,
                        muscles=False, landmarks=True),
    "articulated": dict(radius=1.00, joint_balls=1.22, ball_accent=False,
                        muscles=False, landmarks=True),
    "anatomical":  dict(radius=1.02, joint_balls=0.00, ball_accent=False,
                        muscles=True, landmarks=True),
}

# ---------------------------------------------------------------------------
# Detailed skeleton. The base one above is deliberately coarse; this one adds
# the joints a figure needs to read as a MANNEQUIN rather than an inflated
# tube: a ribcage and hip mass, a flattened hand, a heel-ball-toe foot, and a
# head with a cranium and a jaw instead of an ovoid.
# (name, x, y, z, r_across, r_deep)
D_JOINTS = [
    ("seat",       0.000, 0.000, 0.892, 0.136, 0.110),
    ("pelvis",     0.000, 0.000, 0.968, 0.137, 0.104),
    ("waist",      0.000, 0.000, 1.092, 0.106, 0.086),
    ("ribs",       0.000, 0.000, 1.192, 0.126, 0.100),
    ("chest",      0.000, 0.000, 1.302, 0.149, 0.113),
    ("chest_top",  0.000, 0.000, 1.368, 0.132, 0.101),
    ("yoke",       0.000, 0.000, 1.436, 0.112, 0.094),
    ("neck_base",  0.000, 0.000, 1.492, 0.057, 0.058),
    ("neck",       0.000, 0.000, 1.548, 0.049, 0.051),
    ("jaw",        0.000, -0.006, 1.600, 0.069, 0.081),
    ("cranium",    0.000, -0.004, 1.652, 0.085, 0.098),
    ("crown",      0.000, 0.008, 1.716, 0.060, 0.064),
]
D_LIMB = {
    "clav":       (0.112, 0.000, 1.436, 0.061, 0.063),
    "shoulder":   (0.200, 0.000, 1.428, 0.067, 0.069),
    "delt_low":   (0.208, 0.000, 1.344, 0.057, 0.059),
    "elbow":      (0.219, 0.000, 1.146, 0.046, 0.047),
    "forearm":    (0.225, 0.000, 1.020, 0.040, 0.041),
    "wrist":      (0.232, 0.000, 0.862, 0.029, 0.032),
    "hip":        (0.101, 0.000, 0.908, 0.083, 0.084),
    "thigh":      (0.104, 0.000, 0.720, 0.075, 0.077),
    "knee":       (0.108, 0.000, 0.498, 0.056, 0.058),
    "calf":       (0.110, -0.010, 0.380, 0.057, 0.059),
    "shin":       (0.108, 0.000, 0.210, 0.041, 0.044),
    "ankle":      (0.108, 0.004, 0.116, 0.044, 0.058),
}
D_SPINE_EDGES = [("seat", "pelvis"), ("pelvis", "waist"), ("waist", "ribs"),
                 ("ribs", "chest"), ("chest", "chest_top"), ("chest_top", "yoke"),
                 ("yoke", "neck_base"), ("neck_base", "neck"), ("neck", "jaw"),
                 ("jaw", "cranium"), ("cranium", "crown")]
D_ARM_EDGES = [("yoke", "clav"), ("clav", "shoulder"), ("shoulder", "delt_low"),
               ("delt_low", "elbow"), ("elbow", "forearm"), ("forearm", "wrist")]
D_LEG_EDGES = [("pelvis", "hip"), ("hip", "thigh"), ("thigh", "knee"),
               ("knee", "calf"), ("calf", "shin"), ("shin", "ankle")]
# Explicit extremities, in metres, as (centre, half-extent) before stature scale.
HAND_SHAPE = ((0.234, -0.010, 0.800), (0.046, 0.025, 0.074))
FOOT_SHAPE = ((0.108, -0.034, 0.064), (0.048, 0.100, 0.064))


D_HEAD_KEYS = {"neck", "neck_base", "jaw", "cranium", "crown"}
D_BALL_JOINTS = ["shoulder", "elbow", "wrist", "knee", "ankle"]

VARIANTS.update({
    "display":  dict(radius=1.00, joint_balls=0.00, ball_accent=False, muscles=False,
                     landmarks=True, skeleton="detailed", seams=True, sheen=0.46),
    "artist":   dict(radius=1.00, joint_balls=1.16, ball_accent=False, muscles=False,
                     landmarks=False, skeleton="detailed", seams=False, sheen=0.52),
    "sculpt":   dict(radius=1.00, joint_balls=0.00, ball_accent=False, muscles=True,
                     landmarks=True, skeleton="detailed", seams=False, sheen=0.50),
})
for _v in VARIANTS.values():
    _v.setdefault("skeleton", "base")
    _v.setdefault("seams", False)
    _v.setdefault("sheen", 0.78)
VARIANTS["contoured"] = dict(radius=1.00, joint_balls=0.00, ball_accent=False,
                             muscles=False, landmarks=True, skeleton="detailed",
                             seams=False, sheen=0.52, body="metaball")
for _v in VARIANTS.values():
    _v.setdefault("body", "skin")
SEAM_RGBA = (0.088, 0.082, 0.076, 1.0)
D_SEAM_JOINTS = ["shoulder", "elbow", "knee"]
D_MUSCLE_JOINTS = [
    ("pec",   "chest",    "chest_top", 0.30, 1.06),
    ("delt2", "shoulder", "delt_low",  0.45, 1.12),
    ("quadm", "hip",      "thigh",     0.55, 1.05),
]

BALL_JOINTS = ["shoulder", "elbow", "wrist", "knee", "ankle"]

VARIANTS.update({
    "display":  dict(radius=1.00, joint_balls=0.00, ball_accent=False, muscles=False,
                     landmarks=True, skeleton="detailed", seams=True, sheen=0.46),
    "artist":   dict(radius=1.00, joint_balls=1.16, ball_accent=False, muscles=False,
                     landmarks=False, skeleton="detailed", seams=False, sheen=0.52),
    "sculpt":   dict(radius=1.00, joint_balls=0.00, ball_accent=False, muscles=True,
                     landmarks=True, skeleton="detailed", seams=False, sheen=0.50),
})
for _v in VARIANTS.values():
    _v.setdefault("skeleton", "base")
    _v.setdefault("seams", False)
    _v.setdefault("sheen", 0.78)
VARIANTS["contoured"] = dict(radius=1.00, joint_balls=0.00, ball_accent=False,
                             muscles=False, landmarks=True, skeleton="detailed",
                             seams=False, sheen=0.52, body="metaball")
for _v in VARIANTS.values():
    _v.setdefault("body", "skin")
SEAM_RGBA = (0.088, 0.082, 0.076, 1.0)
# (new joint, from, to, fraction along, radius multiplier vs the from joint)
MUSCLE_JOINTS = [
    ("delt",  "shoulder", "elbow", 0.15, 1.38),
    ("quad",  "hip",      "knee",  0.30, 1.02),
    ("calfm", "knee",     "ankle", 0.24, 1.30),
]


def blender_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    root = repo_root()
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--stage", default="full",
                   choices=["geometry", "rig", "animate", "full"])
    p.add_argument("--variant", default="mannequin", choices=sorted(VARIANTS))
    p.add_argument("--output", type=Path,
                   default=None)
    ns = p.parse_args(blender_args())
    if ns.output is None:
        ns.output = root / "assets" / "blender" / f"ex_001_figure_{ns.variant}.blend"
    return ns


def wipe() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _sets(cfg):
    if cfg["skeleton"] == "detailed":
        return (D_JOINTS, D_LIMB, D_SPINE_EDGES, D_ARM_EDGES, D_LEG_EDGES,
                D_HEAD_KEYS, D_MUSCLE_JOINTS, D_BALL_JOINTS)
    return (JOINTS, LIMB, SPINE_EDGES, ARM_EDGES, LEG_EDGES,
            {"head", "skull", "neck"}, MUSCLE_JOINTS, BALL_JOINTS)


def build_joint_table(cfg):
    joints, limb, _, _, _, head_keys, muscle_joints, _ = _sets(cfg)
    m = cfg["radius"]
    # The head keeps most of its size even in the thin variants, or the figure
    # stops reading as a person and starts reading as a pin.
    hm = max(m, 0.74)
    table = {n: Vector((x, y, z)) for n, x, y, z, _, _ in joints}
    radii = {}
    for n, _, _, _, rx, ry in joints:
        k = hm if n in head_keys else m
        radii[n] = (rx * k, ry * k)
    for base, (x, y, z, rx, ry) in limb.items():
        for side, sign in (("L", 1.0), ("R", -1.0)):
            table[f"{base}.{side}"] = Vector((sign * x, y, z))
            radii[f"{base}.{side}"] = (rx * m, ry * m)
    if cfg["skeleton"] == "detailed":
        # Bone endpoints only. The skin chain stops at wrist and ankle, but the
        # rig still needs somewhere for the hand and foot bones to point.
        for side, sign in (("L", 1.0), ("R", -1.0)):
            (hx, hy, hz), _ = HAND_SHAPE
            (fx, fy, fz), (_, fsy, _) = FOOT_SHAPE
            table[f"hand.{side}"] = Vector((sign * hx, hy, hz))
            radii[f"hand.{side}"] = (0.040, 0.024)
            table[f"toe.{side}"] = Vector((sign * fx, fy - fsy * 0.55, fz))
            radii[f"toe.{side}"] = (0.036, 0.024)

    if cfg["muscles"]:
        for name, a, b, frac, rmul in muscle_joints:
            sided = f"{a}.L" in table
            for side in ("L", "R"):
                ja = f"{a}.{side}" if sided else a
                jb = f"{b}.{side}" if f"{b}.L" in table else b
                key = f"{name}.{side}"
                table[key] = table[ja] + (table[jb] - table[ja]) * frac
                ra = radii[ja]
                radii[key] = (ra[0] * rmul, ra[1] * rmul)
    return table, radii


def edge_list(cfg) -> list[tuple[str, str]]:
    joints, limb, spine_e, arm_e, leg_e, _, muscle_joints, _ = _sets(cfg)
    spine_names = {j[0] for j in joints}
    edges = list(spine_e)
    for side in ("L", "R"):
        for a, b in arm_e + leg_e:
            edges.append((a if a in spine_names else f"{a}.{side}",
                          b if b in spine_names else f"{b}.{side}"))
    if cfg["muscles"]:
        # Splice each swelling joint INTO its chain, so the skin modifier makes
        # a continuous bulge instead of a lump stuck on the surface.
        for name, a, b, _, _ in muscle_joints:
            for side in ("L", "R"):
                ja = a if a in spine_names else f"{a}.{side}"
                jb = b if b in spine_names else f"{b}.{side}"
                jm = f"{name}.{side}"
                edges = [e for e in edges if e != (ja, jb)]
                edges.extend([(ja, jm), (jm, jb)])
    return edges



# ---------------------------------------------------------------------------
# Contoured body.
#
# A skin modifier can only vary the THICKNESS of a tube, so it can never show a
# deltoid sitting proud of a chest or a calf swelling behind a shin. Metaballs
# can: each anatomical mass is its own element, and they fuse into one
# continuous contoured surface.
#
# Masses are placed relative to the joint table, as
#   (name, joint_a, joint_b, t, (dx, dy, dz), (rx, ry, rz), stiffness)
# positioned at lerp(a, b, t) + offset. dx is mirrored per side.
META_GAIN = 1.10
CHAIN_STIFF = 1.75
MASS_GAIN = 1.30
CONTOUR_MASSES = [
    # trunk
    ("glute",    "seat",      "pelvis",   0.10, ( 0.062,  0.062, -0.020), (0.072, 0.062, 0.062), 2.0),
    ("abdomen",  "pelvis",    "waist",    0.45, ( 0.000, -0.022,  0.000), (0.062, 0.048, 0.070), 2.0),
    ("oblique",  "waist",     "ribs",     0.30, ( 0.078,  0.000,  0.000), (0.030, 0.050, 0.062), 2.0),
    ("ribcage",  "ribs",      "chest",    0.55, ( 0.000, -0.008,  0.000), (0.088, 0.060, 0.078), 2.0),
    ("pec",      "chest",     "chest_top",0.28, ( 0.052, -0.062,  0.000), (0.056, 0.024, 0.044), 2.2),
    ("lat",      "ribs",      "chest",    0.62, ( 0.092,  0.026,  0.000), (0.028, 0.048, 0.078), 2.0),
    ("scapula",  "chest",     "chest_top",0.40, ( 0.062,  0.058,  0.000), (0.052, 0.020, 0.058), 2.1),
    ("trap",     "chest_top", "yoke",     0.70, ( 0.052,  0.020,  0.008), (0.058, 0.036, 0.028), 2.1),
    ("sternum",  "chest",     "chest_top",0.10, ( 0.000, -0.078,  0.000), (0.026, 0.014, 0.052), 2.2),
    # arm
    ("deltoid",  "shoulder",  "delt_low", 0.34, ( 0.020,  0.000,  0.010), (0.040, 0.048, 0.058), 2.2),
    ("biceps",   "delt_low",  "elbow",    0.42, (-0.006, -0.020,  0.000), (0.026, 0.026, 0.062), 2.1),
    ("triceps",  "delt_low",  "elbow",    0.38, ( 0.006,  0.022,  0.000), (0.026, 0.024, 0.066), 2.1),
    ("brachio",  "elbow",     "forearm",  0.45, ( 0.004, -0.008,  0.000), (0.030, 0.030, 0.056), 2.1),
    # leg
    ("quad",     "hip",       "thigh",    0.62, (-0.004, -0.030,  0.000), (0.056, 0.036, 0.110), 2.1),
    ("ham",      "hip",       "thigh",    0.55, ( 0.000,  0.036,  0.000), (0.050, 0.030, 0.100), 2.0),
    ("vastus",   "thigh",     "knee",     0.45, ( 0.020, -0.014,  0.000), (0.034, 0.032, 0.072), 2.1),
    ("gastroc",  "knee",      "calf",     0.72, ( 0.000,  0.030,  0.000), (0.040, 0.026, 0.070), 2.1),
    ("tibialis", "calf",      "shin",     0.32, (-0.004, -0.024,  0.000), (0.026, 0.020, 0.062), 2.0),
]


def _mirror(v, sign):
    return Vector((sign * v[0], v[1], v[2]))


def build_metaball_body(table, radii, edges, cfg):
    """Chain of metaballs along every bone, plus anatomical masses on top.

    The chain gives the underlying limb; the masses give the contour. Metaball
    fusion means they read as one sculpted surface rather than parts stuck
    together.
    """
    mb = bpy.data.metaballs.new("FigureMeta")
    mb.resolution = 0.010
    mb.render_resolution = 0.010
    # A metaball surface sits well inside its element radius at the default
    # threshold, so radii are compensated below rather than left nominal.
    mb.threshold = 0.5
    obj = bpy.data.objects.new("FigureMeta", mb)
    bpy.context.scene.collection.objects.link(obj)

    def ball(pos, r, stiffness=2.0):
        el = mb.elements.new(type="BALL")
        el.co = pos
        el.radius = r
        el.stiffness = stiffness
        return el

    def ellipsoid(pos, size, stiffness=2.0):
        el = mb.elements.new(type="ELLIPSOID")
        el.co = pos
        el.size_x, el.size_y, el.size_z = size
        el.radius = 0.042
        el.stiffness = stiffness
        return el

    n = 0
    # 1. the underlying limb: balls stepped along each bone
    for a, b in edges:
        pa, pb = table[a], table[b]
        ra, rb = max(radii[a]), max(radii[b])
        span = (pb - pa).length
        steps = max(2, int(span / 0.028) + 1)
        for i in range(steps + 1):
            f = i / steps
            ball(pa + (pb - pa) * f, (ra * (1 - f) + rb * f) * META_GAIN, CHAIN_STIFF)
            n += 1

    # 2. the contour: anatomical masses
    for name, ja, jb, f, off, size, stiff in CONTOUR_MASSES:
        sided = f"{ja}.L" in table
        for side, sign in (("L", 1.0), ("R", -1.0)):
            ka = f"{ja}.{side}" if sided else ja
            kb = f"{jb}.{side}" if f"{jb}.L" in table else jb
            if ka not in table or kb not in table:
                continue
            base = table[ka] + (table[kb] - table[ka]) * f
            grown = tuple(s * MASS_GAIN for s in size)
            ellipsoid(base + _mirror(off, sign), grown, stiff + 0.6)
            n += 1
            if not sided and abs(off[0]) < 1e-6:
                break   # a midline mass is placed once

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    mesh_obj = bpy.context.active_object
    mesh_obj.name = "Figure"
    mesh_obj.data.name = "Figure"

    # Metaball tessellation is dense and uneven; decimate and smooth it into
    # something a subdivision and an armature can both handle.
    dec = mesh_obj.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = 0.22
    bpy.ops.object.modifier_apply(modifier="Decimate")
    sm = mesh_obj.modifiers.new("Smooth", "SMOOTH")
    sm.factor = 0.4
    sm.iterations = 3
    bpy.ops.object.modifier_apply(modifier="Smooth")
    for poly in mesh_obj.data.polygons:
        poly.use_smooth = True
    return mesh_obj, n


def build_body(table, radii, edges) -> bpy.types.Object:
    """Skin-modifier body: an edge skeleton inflated to per-joint radii, then
    subdivided. One continuous mesh, so it skins cleanly at the shoulder."""
    order = list(table.keys())
    index = {n: i for i, n in enumerate(order)}
    verts = [table[n] for n in order]
    edge_idx = [(index[a], index[b]) for a, b in edges]

    me = bpy.data.meshes.new("Figure")
    me.from_pydata(verts, edge_idx, [])
    me.validate()
    me.update()
    obj = bpy.data.objects.new("Figure", me)
    bpy.context.scene.collection.objects.link(obj)

    skin = obj.modifiers.new("Skin", "SKIN")
    skin.use_smooth_shade = True
    layer = me.skin_vertices[0].data
    for name, i in index.items():
        layer[i].radius = radii[name]
    layer[index["pelvis"]].use_root = True

    sub = obj.modifiers.new("Subdivision", "SUBSURF")
    sub.levels = 2
    sub.render_levels = 2
    return obj



# Bone chains: (bone name, head joint, tail joint, parent bone or None)
BONES = [
    ("root",  "pelvis", "waist", None),
    ("spine", "waist",  "chest", "root"),
    ("chest", "chest",  "yoke",  "spine"),
    ("neck",  "neck",   "head",  "chest"),
    ("head",  "head",   "skull", "neck"),
]
SIDED_BONES = [
    ("clav",     "clav",     "shoulder", "chest"),
    ("upperarm", "shoulder", "elbow",    "clav"),
    ("forearm",  "elbow",    "wrist",    "upperarm"),
    ("hand",     "wrist",    "hand",     "forearm"),
    ("thigh",    "hip",      "knee",     "root"),
    ("shin",     "knee",     "ankle",    "thigh"),
    ("foot",     "ankle",    "toe",      "shin"),
]
# The detailed skeleton has no "head"/"skull"/"hand" joints; these stand in.
D_BONE_ALIAS = {"head": "cranium", "skull": "crown", "hand": "fingers",
                "waist": "waist", "chest": "chest", "yoke": "yoke", "neck": "neck"}

# The movement contract, matching the established seven-second demonstration.
REST_DEG, PEAK_DEG = 12.0, 90.0
PHASES = [(1, 24, "rest"), (25, 96, "raise"), (97, 120, "hold"),
          (121, 192, "lower"), (193, 210, "settle")]


def smoothstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0)


def abduction_at(frame: int) -> float:
    """Degrees of shoulder abduction at a given frame."""
    if frame <= 24:
        return REST_DEG
    if frame <= 96:
        return REST_DEG + (PEAK_DEG - REST_DEG) * smoothstep((frame - 24) / 72.0)
    if frame <= 120:
        return PEAK_DEG
    if frame <= 192:
        return PEAK_DEG - (PEAK_DEG - REST_DEG) * smoothstep((frame - 120) / 72.0)
    return REST_DEG


def clavicle_at(abduction: float) -> float:
    """Scapulohumeral rhythm: past about 30 degrees the girdle contributes
    roughly one degree for every two of humeral elevation. The scoring
    subtracts this, so the demonstration must show it rather than hide it."""
    return 0.0 if abduction <= 30.0 else (abduction - 30.0) / 2.0


def build_armature(table) -> bpy.types.Object:
    def J(name):
        if name in table:
            return table[name]
        base, _, side = name.partition(".")
        alt = D_BONE_ALIAS.get(base, base)
        key = f"{alt}.{side}" if side else alt
        if key in table:
            return table[key]
        raise KeyError(f"no joint for bone endpoint {name}")

    arm_data = bpy.data.armatures.new("FigureRig")
    rig = bpy.data.objects.new("FigureRig", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")

    spec = list(BONES)
    for side in ("L", "R"):
        for name, head, tail, parent in SIDED_BONES:
            spec.append((f"{name}.{side}",
                         head if head in table else f"{head}.{side}",
                         tail if tail in table else f"{tail}.{side}",
                         parent if parent in {b[0] for b in BONES} else f"{parent}.{side}"))

    made = {}
    for name, head, tail, parent in spec:
        eb = arm_data.edit_bones.new(name)
        eb.head = J(head)
        eb.tail = J(tail)
        made[name] = eb
    for name, _, _, parent in spec:
        if parent:
            made[name].parent = made[parent]
            made[name].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def local_rotation(rig, bone_name: str, world_q):
    """Express a world-space rotation in a bone's local space."""
    m = rig.data.bones[bone_name].matrix_local.to_3x3()
    return (m.inverted() @ world_q.to_matrix() @ m).to_quaternion()


def animate(rig, table) -> int:
    action = bpy.data.actions.new("ex_001_lateral_raise")
    rig.animation_data_create()
    rig.animation_data.action = action

    rest_dirs = {}
    for side in ("L", "R"):
        rest_dirs[f"upperarm.{side}"] = (table[f"elbow.{side}"] - table[f"shoulder.{side}"]).normalized()
        rest_dirs[f"clav.{side}"] = (table[f"shoulder.{side}"] - table[f"clav.{side}"]).normalized()
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"

    keys = 0
    for frame in range(FRAME_START, FRAME_END + 1):
        a = abduction_at(frame)
        c = clavicle_at(a)
        for side, sign in (("L", 1.0), ("R", -1.0)):
            # The clavicle is this bone's parent, so its elevation is inherited.
            # Total abduction = scapulothoracic + glenohumeral, so the humerus
            # itself only turns through (a - c); adding the full angle here
            # double-counts the girdle and overshoots the hold.
            rest = rest_dirs[f"upperarm.{side}"]
            gh = math.radians(a - c)
            target = Vector((sign * math.sin(gh), 0.0, -math.cos(gh)))
            q = rest.rotation_difference(target)
            pb = rig.pose.bones[f"upperarm.{side}"]
            pb.rotation_quaternion = local_rotation(rig, f"upperarm.{side}", q)
            pb.keyframe_insert("rotation_quaternion", frame=frame)

            cb = rig.pose.bones[f"clav.{side}"]
            crest = rest_dirs[f"clav.{side}"]
            ctarget = Vector((sign * math.cos(math.radians(c)), 0.0, math.sin(math.radians(c)))).normalized()
            cq = crest.rotation_difference(ctarget)
            cb.rotation_quaternion = local_rotation(rig, f"clav.{side}", cq)
            cb.keyframe_insert("rotation_quaternion", frame=frame)
            keys += 2
    return keys


def bind(body, rig) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")



BODY_RGBA = (0.330, 0.296, 0.256, 1.0)
MARK_RGBA = (0.042, 0.150, 0.101, 1.0)


def flat_material(name, rgba, rough=0.78):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = rgba
    b.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.16
    return mat


def add_landmarks(body, table, radii, scale, mark_mat):
    """Put the three measured references onto the figure itself.

    They are joined into the body BEFORE skinning, so automatic weights carry
    them and the acromion bands ride the girdle - which is precisely what makes
    a shrug legible. The material is assigned to each mark BEFORE the join:
    joining a slot-less object otherwise inserts an empty slot and shifts every
    index after it.
    """
    marks = []

    # Acromion bands: a ring around the deltoid reads from the front, where a
    # disc buried at the joint centre would sit inside the skin and vanish.
    for side in ("L", "R"):
        sh = table[f"shoulder.{side}"]
        el = table[f"elbow.{side}"]
        # Sized from the LOCAL limb radius, not a fixed value: in the fuller
        # variants a fixed band is swallowed by the deltoid.
        pos = sh + (el - sh) * 0.30
        rs, re_ = max(radii[f'shoulder.{side}']), max(radii[f'elbow.{side}'])
        band_r = (rs * 0.70 + re_ * 0.30) * 1.18
        bpy.ops.mesh.primitive_torus_add(location=(pos.x, pos.y, pos.z),
                                         major_radius=band_r * scale,
                                         minor_radius=0.0075 * scale,
                                         major_segments=28, minor_segments=8)
        marks.append(bpy.context.active_object)

    pel = table["pelvis"]
    bpy.ops.mesh.primitive_torus_add(location=(0.0, pel.y, pel.z),
                                     major_radius=0.140 * scale,
                                     minor_radius=0.0085 * scale,
                                     major_segments=40, minor_segments=8)
    marks.append(bpy.context.active_object)

    chest, waist = table["chest"], table["waist"]
    mid = (chest + waist) / 2.0
    bpy.ops.mesh.primitive_cube_add(location=(0.0, mid.y - 0.098 * scale, mid.z))
    axis = bpy.context.active_object
    axis.scale = (0.008 * scale, 0.006 * scale, (chest.z - waist.z) * 0.62)
    marks.append(axis)

    for o in marks:
        o.data.materials.append(mark_mat)

    bpy.ops.object.select_all(action="DESELECT")
    for o in marks:
        o.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    return len(marks)



def add_extremities(body, scale, mat):
    """Mitten hands and shaped feet.

    The skin chain now stops at the wrist and the ankle: a tapering chain end
    is always a cone, and cones read as claws, not as a mannequin. These are
    joined before skinning so automatic weights carry them with the limb.
    """
    made = []
    for (cx, cy, cz), (sx, sy, sz) in (HAND_SHAPE, FOOT_SHAPE):
        for sign in (1.0, -1.0):
            bpy.ops.mesh.primitive_uv_sphere_add(
                radius=1.0, segments=24, ring_count=16,
                location=(sign * cx * scale, cy * scale, cz * scale))
            o = bpy.context.active_object
            o.scale = (sx * scale, sy * scale, sz * scale)
            made.append(o)
    if mat is not None:
        for o in made:
            o.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    for o in made:
        o.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    return len(made)


def add_joint_balls(body, table, radii, cfg, scale, mat):
    """Visible ball joints: an artist mannequin read, and in the thin variant
    the only thing that says where the joints are."""
    made = []
    for base in _sets(cfg)[7]:
        for side in ("L", "R"):
            key = f"{base}.{side}"
            q = table[key]
            r = max(radii[key]) * cfg["joint_balls"] * scale
            bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=20, ring_count=12,
                                                 location=(q.x, q.y, q.z))
            made.append(bpy.context.active_object)
    if mat is not None:
        for o in made:
            o.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    for o in made:
        o.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    return len(made)


def add_seams(body, table, radii, scale, mat):
    """Thin dark rings where a display mannequin separates. They read as
    manufactured articulation rather than as anatomy."""
    made = []
    for base in D_SEAM_JOINTS:
        for side in ("L", "R"):
            key = f"{base}.{side}"
            if key not in table:
                continue
            q = table[key]
            r = max(radii[key]) * 1.015
            bpy.ops.mesh.primitive_torus_add(location=(q.x, q.y, q.z),
                                             major_radius=r * scale,
                                             minor_radius=0.0062 * scale,
                                             major_segments=32, minor_segments=8)
            made.append(bpy.context.active_object)
    for o in made:
        o.data.materials.append(mat)
    bpy.ops.object.select_all(action="DESELECT")
    for o in made:
        o.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    return len(made)


def build_studio(scene, table, stature):
    for o in [x for x in bpy.data.objects if x.type in {"LIGHT", "CAMERA"}]:
        bpy.data.objects.remove(o, do_unlink=True)

    bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.name = "Floor"
    floor.data.materials.append(flat_material("Floor", (0.208, 0.198, 0.180, 1.0), 0.94))

    aim = Vector((0.0, 0.0, table["chest"].z))
    for name, energy, size, loc in (
        ("Key",  205.0, 4.2, (-1.6, -3.6, 2.8)),
        ("Fill", 132.0, 5.2, (2.3, -3.1, 1.8)),
        ("Top",   72.0, 3.0, (0.0, -0.7, 3.8)),
    ):
        d = bpy.data.lights.new(name, "AREA")
        d.energy, d.size, d.shape = energy, size, "SQUARE"
        o = bpy.data.objects.new(name, d)
        o.location = loc
        o.rotation_euler = (aim - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(o)

    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.130, 0.124, 0.112, 1.0)
        bg.inputs["Strength"].default_value = 1.1

    # Camera derived from the capture-readiness gate, not chosen by eye.
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 52.0
    cam_data.sensor_fit = "VERTICAL"
    cam = bpy.data.objects.new("Camera", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    HEAD_FRAC, FOOT_MARGIN = 0.13, 0.06
    span = stature / (1.0 - HEAD_FRAC - FOOT_MARGIN)
    dist = span / (2.0 * math.tan(math.atan(cam_data.sensor_height / (2.0 * cam_data.lens))))
    top = stature + HEAD_FRAC * span
    cam.location = (0.0, -dist, top - span / 2.0)
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)

    # A standing figure is tall, but at the hold it is WIDER than it is tall
    # through the shoulders. The frame width is derived from the peak span so
    # the hands never leave the shot.
    tip = next(k for k in ("fingers.L", "hand.L") if k in table)
    arm_len = (table[tip] - table["shoulder.L"]).length
    peak_span = 2.0 * (table["shoulder.L"].x + arm_len)
    need_x = peak_span * 1.10
    scene.render.resolution_y = 980
    scene.render.resolution_x = max(720, int(math.ceil(scene.render.resolution_y * need_x / span)))
    aspect = scene.render.resolution_x / scene.render.resolution_y
    if need_x > span * aspect + 1e-6:
        raise RuntimeError("Peak arm span does not fit the frame")

    head_frac = (top - stature) / span
    knee_frac = (top - table["knee.L"].z) / span
    foot_frac = top / span
    if not (0.05 <= head_frac <= 0.25):
        raise RuntimeError(f"Head fraction {head_frac:.3f} outside the gate band")
    if foot_frac >= 1.0:
        raise RuntimeError("Feet fall outside frame")
    return {"head_fraction": round(head_frac, 4), "knee_fraction": round(knee_frac, 4),
            "foot_fraction": round(foot_frac, 4), "camera_distance": round(dist, 4),
            "peak_span_m": round(peak_span, 4),
            "resolution": [scene.render.resolution_x, scene.render.resolution_y]}


def main() -> None:
    args = parse_args()
    wipe()

    cfg = VARIANTS[args.variant]
    table, radii = build_joint_table(cfg)
    edges = edge_list(cfg)
    if cfg.get("body") == "metaball":
        body, mass_count = build_metaball_body(table, radii, edges, cfg)
    else:
        body = build_body(table, radii, edges)
        mass_count = 0

    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = FRAME_START, FRAME_END
    scene.render.fps = FPS
    scene.render.resolution_x, scene.render.resolution_y = 720, 960

    # The skin modifier must be applied before anything is joined or bound, or
    # the armature deforms the edge skeleton rather than the body surface.
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    for mod in list(body.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)

    if cfg["skeleton"] == "detailed":
        add_extremities(body, 1.0, None)

    # Skin + subdivision shrink the silhouette below the joint extents, so the
    # figure is scaled once to the intended stature rather than fudging radii.
    # The joint table is scaled with it, so the rig and landmarks stay in the
    # same space as the body.
    zs = [(body.matrix_world @ v.co).z for v in body.data.vertices]
    raw_h = max(zs) - min(zs)
    scale = 1.0
    if raw_h > 1e-6:
        scale = STATURE / raw_h
        body.scale = (scale,) * 3
        bpy.context.view_layer.update()
        with bpy.context.temp_override(active_object=body, selected_editable_objects=[body]):
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        for k in table:
            table[k] = table[k] * scale

    rig = None
    keys = 0
    marks = 0
    framing = {}

    if args.stage == "full":
        body.data.materials.append(flat_material("Figure_Body", BODY_RGBA, cfg["sheen"]))
        mark_mat = flat_material("Figure_Landmark", MARK_RGBA, 0.58)
        seam_mat = flat_material("Figure_Seam", SEAM_RGBA, 0.44)
        body_faces = len(body.data.polygons)
        for poly in body.data.polygons:
            poly.material_index = 0
        if cfg["joint_balls"] > 0.0:
            add_joint_balls(body, table, radii, cfg, scale,
                            mark_mat if cfg["ball_accent"] else None)
            if not cfg["ball_accent"]:
                body_faces = len(body.data.polygons)
        if cfg["seams"]:
            add_seams(body, table, radii, scale, seam_mat)
            seam_faces = len(body.data.polygons)
        marks = add_landmarks(body, table, radii, scale, mark_mat) if cfg["landmarks"] else 0
        seam_slot = body.data.materials.find(seam_mat.name)
        mark_slot = body.data.materials.find(mark_mat.name)
        boundary = seam_faces if cfg["seams"] else body_faces
        for i, poly in enumerate(body.data.polygons):
            if i < body_faces:
                continue
            if cfg["seams"] and i < boundary and seam_slot >= 0:
                poly.material_index = seam_slot
            elif mark_slot >= 0:
                poly.material_index = mark_slot

    if args.stage in {"rig", "animate", "full"}:
        rig = build_armature(table)
        bind(body, rig)
    if args.stage in {"animate", "full"} and rig is not None:
        keys = animate(rig, table)
    if args.stage == "full":
        framing = build_studio(scene, table, STATURE)

    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    zs = [(body.matrix_world @ v.co).z for v in me.vertices]
    xs = [(body.matrix_world @ v.co).x for v in me.vertices]
    verts = len(me.vertices)
    ev.to_mesh_clear()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output))

    print("EX001_FIGURE=" + json.dumps({
        "stage": args.stage,
        "variant": args.variant,
        "output": str(args.output),
        "evaluated_verts": verts,
        "height_m": round(max(zs) - min(zs), 4),
        "width_m": round(max(xs) - min(xs), 4),
        "joints": len(table),
        "keyframes": keys,
        "landmarks": marks,
        "metaball_elements": mass_count,
        **framing,
        "bones": len(rig.data.bones) if rig else 0,
        "edges": len(edges),
    }, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
