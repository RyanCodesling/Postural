"""Author the ex_001 demonstration figure from a freshly generated MPFB human.

The body comes from MPFB2 / MakeHuman system assets, which are CC0. It is a NEW
character rather than a copy of Maya: neutral gender, universal phenotype,
average build. MakeHuman characters all share one base topology by design, so
the vertex count matches Maya's - what differs is the morphology, which is the
character.

Everything above the body is the demonstration design worked out earlier:
matte surface so speculars stop inventing landmarks on the deltoid, acromion /
trunk / pelvis landmark marks, a broad frontal key with heavy fill, a camera
derived from the capture-readiness gate, and the rest/raise/hold/lower/settle
action with the approved authored shoulder-girdle elevation.

Fresh generation requires MPFB2. --source reuses a saved, baked Figure_Body
and Figure_Rig without loading the add-on or changing the body morphology.
See assets/blender/THIRD_PARTY_ASSETS.md for CC0 source provenance.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

FRAME_START, FRAME_END, FPS = 1, 210, 30
REST_DEG, PEAK_DEG = 12.0, 90.0
STANDARD_RIG = "game_engine"
DEFAULT_GIRDLE_SCALE = 0.475
FRAME_SIDE_MARGIN = 0.065
FIGURE_REVISION = "mpfb-garments-2026-09-06"

BODY_RGBA = (0.336, 0.300, 0.262, 1.0)
MARK_RGBA = (0.042, 0.150, 0.101, 1.0)
# Emission runs hot and desaturates on screen, so the glow colour is a
# saturated version of the mark rather than the mark colour itself.
MARK_GLOW = (0.040, 0.720, 0.400, 1.0)
MARK_GLOW_STRENGTH = 2.2

# Landmark mark geometry, in metres. The shader evaluates these per pixel from
# the baked rest position, so they are the true rendered half-widths - the mesh
# resolution does not enter into it. See build_mark_sdf.
MARK_BAND_HALF = 0.011    # acromion band, measured along the arm
MARK_AXIS_HALF = 0.009    # trunk axis
MARK_PELVIS_HALF = 0.010  # pelvis line
BAND_ALONG = 0.075        # band centre, measured down the arm axis from the joint
# Measured, not guessed: within the band's slab the arm surface runs out to
# 0.090 (p50 0.053, the tail being the axillary fold) while the nearest non-arm
# vertex is at 0.072. Those overlap, so NO radius separates arm from torso here
# - at rest the arm hangs against the ribs. The radius is therefore set to clear
# the whole limb, and the arm-weight gate closes the ring, which is the same
# discriminator the armhole seam already uses. The old code had no radial bound
# at all and a 0.085 capsule, so it caught the chest wall at 0.072 and left two
# marks there that only became visible once the arm abducted away from them.
BAND_RADIUS = 0.095
# Only the build-time sanity count uses this; the shader does not.
MARK_FEATHER = 0.014

# Neutral by design: a demonstration figure that signals a sex, an age or an
# ethnicity excludes the patients it does not resemble.
PHENOTYPE = {
    "phenotype_gender": "neutral",
    "phenotype_race": "universal",
    "phenotype_age": "young",
    "phenotype_muscle": "averagemuscle",
    "phenotype_weight": "averageweight",
    "phenotype_height": "average",
    "phenotype_proportions": "average",
    "phenotype_breastsize": "mincup",
    "phenotype_breastfirmness": "maxfirmness",
}


def blender_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output", type=Path,
                   default=repo_root() / "assets" / "blender" / "ex_001_figure_mpfb.blend")
    p.add_argument("--stage", default="full", choices=["body", "full"])
    p.add_argument("--source", type=Path,
                   help="Reuse a baked MPFB figure; no add-on needed")
    p.add_argument("--girdle-scale", type=float, default=DEFAULT_GIRDLE_SCALE)
    args = p.parse_args(blender_args())
    if not math.isfinite(args.girdle_scale) or args.girdle_scale < 0:
        p.error("--girdle-scale must be finite and nonnegative")
    if args.source and args.stage != "full":
        p.error("--source is only supported with --stage full")
    return args


def smoothstep(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0)


def abduction_at(frame: int) -> float:
    if frame <= 24:
        return REST_DEG
    if frame <= 96:
        return REST_DEG + (PEAK_DEG - REST_DEG) * smoothstep((frame - 24) / 72.0)
    if frame <= 120:
        return PEAK_DEG
    if frame <= 192:
        return PEAK_DEG - (PEAK_DEG - REST_DEG) * smoothstep((frame - 120) / 72.0)
    return REST_DEG


def clavicle_at(abduction: float, scale: float = DEFAULT_GIRDLE_SCALE) -> float:
    """Girdle contribution past ~30 degrees, one degree for every two of
    elevation, times `scale`. The scoring subtracts an expected rhythm, so the
    demonstration shows the contribution rather than hiding it.

    IMPORTANT, 2026-09-03: this is girdle ELEVATION, not scapular upward
    ROTATION. The scapular half of scapulohumeral rhythm is upward rotation -
    the glenoid tilting superiorly - whereas raising the clavicle in the frontal
    plane translates the whole girdle toward the ear, which is a shrug. The
    `game_engine` rig has no scapula bone (spine_01..03, clavicle, neck_01,
    head), so upward rotation cannot be represented on it and the clavicle is
    the only girdle bone available.

    That matters because scapular elevation is the PRIMARY compensation ex_001
    scores. Measured against the registry's own primary-coupled fit
    (expected = -0.0077 + 0.00124 * abduction, warningThreshold 0.04), at the
    90-degree hold:

        scale 1.00  ->  30.28 deg  ->  residual +0.0907   (~2x over threshold)
        scale 0.475 ->  14.37 deg  ->  residual  0.0000   (on the expected line)
        scale 0.00  ->   0.00 deg  ->  residual -0.1039   (below it; not penalised)

    The threshold is crossed at roughly 20.8 degrees. Those figures are
    indicative rather than exact: the registry constants were fitted in the
    anisotropically normalized webcam space while this is measured in
    true 3D, and the metric mixes x and z so the distortion does not cancel.
    """
    return 0.0 if abduction <= 30.0 else (abduction - 30.0) / 2.0 * scale


def flat_material(name, rgba, rough=0.74):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = rgba
    b.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.16
    return mat


def generate_human(scene) -> tuple[bpy.types.Object, bpy.types.Object]:
    for key, value in PHENOTYPE.items():
        setattr(scene, f"MPFB_NH_{key}", value)
    scene.MPFB_NH_add_phenotype = True
    # No breast shaping at all. Post-hoc relaxation of the nipple only removes
    # the point - the rim of any patch small enough to be local still sits on
    # the breast slope, so the surface spanning it keeps bulging. Turning the
    # feature off at generation removes it at the source, and a flat chest is
    # the right read for a neutral clinical figure in any case.
    scene.MPFB_NH_add_breast = False
    scene.MPFB_NH_breast_influence = 0.0
    scene.MPFB_NH_load_clothes = False          # the demonstration supplies its own surface
    scene.MPFB_NH_auto_generate_rigify = False
    scene.MPFB_ADR_standard_rig = STANDARD_RIG
    scene.MPFB_ADR_import_weights = True

    bpy.ops.mpfb.create_human()
    body = next((o for o in bpy.data.objects if o.type == "MESH"), None)
    if body is None:
        raise RuntimeError("MPFB produced no mesh")
    body.name = "Figure_Body"

    rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if rig is None:
        bpy.context.view_layer.objects.active = body
        body.select_set(True)
        bpy.ops.mpfb.add_standard_rig()
        rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if rig is None:
        raise RuntimeError("MPFB produced no armature")
    rig.name = "Figure_Rig"
    return body, rig


def aim_bone(pb, direction: Vector) -> None:
    """Swing a pose bone onto a world direction, PRESERVING its roll.

    Building the orientation from scratch off +Y also rewrites the bone's roll,
    and roll on the upper arm swings its child forearm around the arm axis - it
    put the forearm at 133 degrees while the humerus was correctly at 90. Taking
    the minimal rotation from the bone's current direction leaves roll alone.
    """
    m = pb.matrix.copy()
    basis = m.to_3x3()
    current = (basis @ Vector((0.0, 1.0, 0.0))).normalized()
    q = current.rotation_difference(direction.normalized())
    new = (q.to_matrix() @ basis).to_4x4()
    new.translation = m.to_translation()
    pb.matrix = new


def animate(rig, girdle_scale: float = DEFAULT_GIRDLE_SCALE) -> int:
    names = {b.name for b in rig.data.bones}

    def pick(*cands):
        for c in cands:
            if c in names:
                return c
        return None

    pairs = {}
    for side, sign in (("l", 1.0), ("r", -1.0)):
        ua = pick(f"upperarm_{side}", f"upper_arm_{side}")
        cl = pick(f"clavicle_{side}", f"shoulder_{side}")
        if ua is None or cl is None:
            raise RuntimeError(f"cannot find arm bones for side {side}")
        pairs[side] = (ua, cl, sign)

    rig.animation_data_clear()
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.frame_set(FRAME_START)
    bpy.context.view_layer.update()
    action = bpy.data.actions.new("ex_001_lateral_raise")
    rig.animation_data_create()
    rig.animation_data.action = action
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"

    keys = 0
    for frame in range(FRAME_START, FRAME_END + 1):
        a = abduction_at(frame)
        c = clavicle_at(a, girdle_scale)
        for side, (ua, cl, sign) in pairs.items():
            # Girdle first: the humerus is its child, so it must be posed before
            # the arm is aimed at the total abduction angle.
            cb = rig.pose.bones[cl]
            rest_c = (rig.data.bones[cl].tail_local - rig.data.bones[cl].head_local).normalized()
            elev = math.radians(c)
            ctarget = Vector((sign * abs(rest_c.x) * math.cos(elev),
                              rest_c.y,
                              math.sin(elev))).normalized()
            aim_bone(cb, ctarget)
            cb.keyframe_insert("rotation_quaternion", frame=frame)

            bpy.context.view_layer.update()

            rad = math.radians(a)
            target = Vector((sign * math.sin(rad), 0.0, -math.cos(rad)))
            pb = rig.pose.bones[ua]
            aim_bone(pb, target)
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            bpy.context.view_layer.update()
            # Remove the inherited wrist kink while preserving palm roll and
            # the existing relaxed finger pose. This is an authored display
            # pose, not a clinical wrist-angle or hand-orientation prescription.
            forearm = rig.pose.bones[f"lowerarm_{side}"]
            hand = rig.pose.bones[f"hand_{side}"]
            aim_bone(hand, (forearm.tail - forearm.head).normalized())
            hand.keyframe_insert("rotation_quaternion", frame=frame)
            keys += 3
    return keys


def projected_body_bounds(scene, body):
    """Measure the evaluated visible silhouette at every authored frame."""
    saved_frame = scene.frame_current
    samples = []
    try:
        for frame in range(FRAME_START, FRAME_END + 1):
            scene.frame_set(frame)
            dg = bpy.context.evaluated_depsgraph_get()
            evaluated = body.evaluated_get(dg)
            mesh = evaluated.to_mesh()
            try:
                co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
                mesh.vertices.foreach_get("co", co)
                points = np.ones((len(mesh.vertices), 4), dtype=np.float32)
                points[:, :3] = co.reshape(-1, 3)
                projection = scene.camera.calc_matrix_camera(
                    dg, x=scene.render.resolution_x, y=scene.render.resolution_y,
                    scale_x=scene.render.pixel_aspect_x, scale_y=scene.render.pixel_aspect_y)
                matrix = projection @ scene.camera.matrix_world.inverted() @ evaluated.matrix_world
                clip = points @ np.array(matrix, dtype=np.float32).T
                if np.any(clip[:, 3] <= 0):
                    raise RuntimeError("Figure crosses or sits behind the camera")
                xy = clip[:, :2] / clip[:, 3:4] * 0.5 + 0.5
                samples.append({"frame": frame,
                                "xmin": float(xy[:, 0].min()), "xmax": float(xy[:, 0].max()),
                                "ymin": float(xy[:, 1].min()), "ymax": float(xy[:, 1].max())})
            finally:
                evaluated.to_mesh_clear()
    finally:
        scene.frame_set(saved_frame)
    return samples


def add_preview_labels(scene):
    """Camera-aligned, editable presentation text in the reserved headroom."""
    camera = scene.camera
    corners = camera.data.view_frame(scene=scene)
    corners = [v / abs(v.z) for v in corners]
    xmin, xmax = min(v.x for v in corners), max(v.x for v in corners)
    ymin, ymax = min(v.y for v in corners), max(v.y for v in corners)
    mat = bpy.data.materials.new("Figure preview text")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    emission = nt.nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (0.85, 0.88, 0.83, 1.0)
    emission.inputs["Strength"].default_value = 1.6
    output = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(emission.outputs[0], output.inputs["Surface"])

    def label(name, text, x, y, pixels, align="LEFT"):
        data = bpy.data.curves.new(name, "FONT")
        data.body, data.align_x = text, align
        data.size = pixels / scene.render.resolution_y * (ymax - ymin)
        data.space_character = 1.05
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.parent = camera
        obj.location = (xmin + x * (xmax - xmin), ymin + y * (ymax - ymin), -1.0)
        obj.data.materials.append(mat)
        obj.visible_shadow = False
        return obj

    label("Preview title", "Lateral arm raise", .065, .951, 30)
    label("Preview guides", "Green guides: arm level / torso alignment / hip level", .065, .910, 19)
    for word, start, end in [("Ready", 1, 24), ("Raise", 25, 95),
                             ("Pause", 96, 120), ("Lower", 121, 191), ("Ready", 192, 210)]:
        obj = label(f"Preview phase {start:03d}", word, .935, .951, 27, "RIGHT")
        # Boolean visibility is a discrete channel. All phase changes happen
        # on exact frame boundaries, with exactly one phase visible per frame.
        for frame in sorted({1, start, end + 1, FRAME_END + 1}):
            obj.hide_render = obj.hide_viewport = not (start <= frame <= end)
            obj.keyframe_insert("hide_render", frame=frame)
            obj.keyframe_insert("hide_viewport", frame=frame)
    scene.frame_set(FRAME_START)



TOP_RGBA = (0.128, 0.250, 0.226, 1.0)
SHORT_RGBA = (0.118, 0.126, 0.136, 1.0)


def garment_from_body(body, rig, keep, name, mat, thickness=0.007, lift=0.005):
    """Cut a fitted garment out of the body surface.

    Geometry is copied from the body, so the fit is exact and nothing is
    modelled. The armhole is GEOMETRIC - a sphere around the shoulder joint -
    because excluding by clavicle weight also removes the whole upper chest and
    leaves a bandeau.
    """
    src = body.data
    faces = [poly for poly in src.polygons if all(keep(v) for v in poly.vertices)]
    if not faces:
        raise RuntimeError(f"{name}: no complete faces selected")
    used = sorted({v for poly in faces for v in poly.vertices})
    remap = {o: n for n, o in enumerate(used)}
    me = bpy.data.meshes.new(name)
    me.from_pydata([src.vertices[i].co.copy() for i in used], [],
                   [[remap[v] for v in poly.vertices] for poly in faces])
    me.validate()
    me.update()
    obj = bpy.data.objects.new(name, me)
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)

    names = {g.index: g.name for g in body.vertex_groups}
    for g in body.vertex_groups:
        obj.vertex_groups.new(name=g.name)
    for new_i, old_i in enumerate(used):
        for g in src.vertices[old_i].groups:
            gname = names.get(g.group)
            if gname:
                obj.vertex_groups[gname].add([new_i], g.weight, "REPLACE")

    obj.parent = rig
    obj.matrix_world = body.matrix_world.copy()
    d = obj.modifiers.new("Lift", "DISPLACE")
    d.strength, d.mid_level, d.direction = lift, 0.0, "NORMAL"
    s = obj.modifiers.new("Cloth", "SOLIDIFY")
    s.thickness, s.offset, s.use_rim = thickness, 1.0, True
    a = obj.modifiers.new("Armature", "ARMATURE")
    a.object = rig
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj



def bake_shape_keys(body) -> int:
    """Collapse MPFB's phenotype shape keys into the base mesh.

    Editing `mesh.vertices[i].co` while shape keys are active does nothing: the
    evaluated surface comes from the key mix, not the base. Every geometry edit
    below - the chest flattening in particular - silently had no effect until
    these were baked down.
    """
    if body.data.shape_keys is None:
        return 0
    n = len(body.data.shape_keys.key_blocks)
    mix = body.shape_key_add(name="_bake", from_mix=True)
    coords = [point.co.copy() for point in mix.data]
    body.shape_key_clear()
    for i, c in enumerate(coords):
        body.data.vertices[i].co = c
    body.data.update()
    return n


def flatten_chest(body, rig):
    """Remove the nipple geometry from the body outright.

    The clothing is painted onto the body, so the body IS the visible surface
    and any protrusion reads through. Relaxing the whole patch only shrinks it,
    because the rim moves too. Pinning the surrounding ring and relaxing only
    the interior converges to a smooth membrane spanning that ring, which
    removes the protrusion rather than merely reducing it. Every other contour
    is untouched.
    """
    rm = rig.matrix_world
    clav_z = (rm @ rig.data.bones["clavicle_l"].head_local).z
    pelvis_z = (rm @ rig.data.bones["pelvis"].head_local).z
    lo = pelvis_z + (clav_z - pelvis_z) * 0.35
    mw = body.matrix_world
    co = [mw @ v.co for v in body.data.vertices]

    tips = []
    for sign in (1.0, -1.0):
        cand = [i for i, q in enumerate(co)
                if lo < q.z < clav_z and q.y < 0.0 and 0.02 < q.x * sign < 0.13]
        if cand:
            tips.append(co[min(cand, key=lambda i: co[i].y)])
    if not tips:
        return 0

    # Wide enough that the pinned rim lands on flat chest wall. A patch that
    # only just encloses the nipple keeps its rim on the surrounding mound, and
    # the membrane spanning that rim is still a dome.
    RADIUS = 0.090
    region = {i for i, q in enumerate(co) if any((q - tip).length < RADIUS for tip in tips)}
    if not region:
        return 0

    neigh = {i: set() for i in region}
    for e in body.data.edges:
        a, b = e.vertices
        if a in region:
            neigh[a].add(b)
        if b in region:
            neigh[b].add(a)

    # Pin the rim: any region vertex touching something outside it.
    pinned = {i for i in region if any(n not in region for n in neigh[i])}
    interior = [i for i in region if i not in pinned]
    if not interior:
        return 0

    verts = body.data.vertices
    for _ in range(160):
        moved = {}
        for i in interior:
            ns = neigh[i]
            if not ns:
                continue
            moved[i] = sum((verts[n].co for n in ns), Vector()) / len(ns)
        for i, q in moved.items():
            verts[i].co = q
    body.data.update()
    return len(interior)


def _smoothstep(edge0, edge1, x):
    if edge0 == edge1:
        return 0.0 if x < edge0 else 1.0
    v = (x - edge0) / (edge1 - edge0)
    v = max(0.0, min(1.0, v))
    return v * v * (3.0 - 2.0 * v)


def _wire(nt, node, idx, val):
    """Wire `val` into input `idx`: a socket becomes a link, a number a default."""
    if isinstance(val, bpy.types.NodeSocket):
        nt.links.new(val, node.inputs[idx])
    elif val is not None:
        node.inputs[idx].default_value = val


def _math(nt, op, a, b=None, loc=(0, 0)):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.location = loc
    _wire(nt, n, 0, a)
    _wire(nt, n, 1, b)
    return n.outputs[0]


def _vmath(nt, op, a, b=None, scale=None, loc=(0, 0)):
    n = nt.nodes.new("ShaderNodeVectorMath")
    n.operation = op
    n.location = loc
    _wire(nt, n, 0, a)
    if b is not None:
        _wire(nt, n, 1, b)
    if scale is not None:
        _wire(nt, n, "Scale", scale)
    # Only these three collapse a vector to a scalar; the rest stay vectors.
    return n.outputs["Value"] if op in {"DOT_PRODUCT", "LENGTH", "DISTANCE"} else n.outputs["Vector"]


def build_mark_sdf(nt, arm_axes, waist_z, chest_z, pelvis_z, x=-200):
    """Evaluate the landmark marks in the SHADER, from a baked rest position.

    Marks used to be a per-vertex float. That has a hard resolution wall: the
    mesh's mark-region edges have a median of about 19 mm, and a line 18-22 mm
    wide is thinner than that, so on any face spanning the line both vertices
    lie outside it and no interpolation can put the line back. Widening the
    line or blurring the field only trades one artifact for another.

    Baking the REST POSITION instead moves the evaluation to the pixel. A
    position interpolates exactly across a face, so the shader reconstructs the
    true rest coordinate at every shaded point and the distance fields below are
    evaluated there at full render resolution. The marks are then exactly their
    declared width, whatever the mesh does, and they still ride the body: the
    attribute travels with the vertices the armature deforms, so a shrug still
    lifts the bands.

    Each mark contributes a signed value `half - distance`, positive inside.
    Taking the maximum over all of them is the standard union, and one Map Range
    at zero turns the union into a mask with a sub-millimetre anti-aliased edge.
    """
    co = nt.nodes.new("ShaderNodeAttribute")
    co.attribute_name = "rest_co"
    co.location = (x, 700)
    pos = co.outputs["Vector"]

    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (x + 180, 700)
    nt.links.new(pos, sep.inputs[0])
    px, py, pz = sep.outputs["X"], sep.outputs["Y"], sep.outputs["Z"]

    # Pelvis line: wraps the body at the pelvis.
    s = _math(nt, "SUBTRACT", MARK_PELVIS_HALF,
              _math(nt, "ABSOLUTE", _math(nt, "SUBTRACT", pz, pelvis_z, loc=(x + 360, 900)),
                    loc=(x + 520, 900)),
              loc=(x + 680, 900))

    # Trunk axis: a box SDF down the front centreline. The `y` bound keeps it
    # off the back without a separate gate - behind the body y is positive, so
    # that term dominates the maximum and drives the whole field negative.
    d_axis = _math(nt, "MAXIMUM",
                   _math(nt, "MAXIMUM",
                         _math(nt, "ABSOLUTE", px, loc=(x + 360, 620)),
                         _math(nt, "SUBTRACT", waist_z, pz, loc=(x + 360, 500)),
                         loc=(x + 520, 560)),
                   _math(nt, "MAXIMUM",
                         _math(nt, "SUBTRACT", pz, chest_z, loc=(x + 360, 380)),
                         py, loc=(x + 520, 400)),
                   loc=(x + 680, 480))
    s = _math(nt, "MAXIMUM", s, _math(nt, "SUBTRACT", MARK_AXIS_HALF, d_axis,
                                     loc=(x + 840, 480)), loc=(x + 1000, 700))

    # Acromion band: a ring round each deltoid, bounded along the arm AND
    # radially off its axis, then gated on arm weight. The radial bound is what
    # keeps it on the limb; the weight gate is the backstop for the armpit,
    # where arm and ribcage surfaces very nearly touch.
    armw = nt.nodes.new("ShaderNodeAttribute")
    armw.attribute_name = "armw"
    armw.location = (x, 120)
    gate = nt.nodes.new("ShaderNodeMapRange")
    gate.location = (x + 180, 120)
    gate.clamp = True
    gate.inputs["From Min"].default_value = 0.40
    gate.inputs["From Max"].default_value = 0.50
    nt.links.new(armw.outputs["Fac"], gate.inputs["Value"])
    # Off the arm the gate is 0, and subtracting a metre puts the band far
    # outside any half-width, so it cannot win the union.
    penalty = _math(nt, "MULTIPLY",
                    _math(nt, "SUBTRACT", 1.0, gate.outputs["Result"], loc=(x + 360, 120)),
                    1.0, loc=(x + 520, 120))

    for i, (a, b) in enumerate(arm_axes):
        n = (b - a).normalized()
        y = -120 - i * 420
        q = _vmath(nt, "SUBTRACT", pos, tuple(a), loc=(x + 180, y))
        along = _vmath(nt, "DOT_PRODUCT", q, tuple(n), loc=(x + 360, y))
        perp = _vmath(nt, "SUBTRACT", q, _vmath(nt, "SCALE", tuple(n), scale=along,
                                                loc=(x + 520, y - 140)), loc=(x + 680, y))
        radial = _vmath(nt, "LENGTH", perp, loc=(x + 840, y))
        d = _math(nt, "MAXIMUM",
                  _math(nt, "ABSOLUTE", _math(nt, "SUBTRACT", along, BAND_ALONG,
                                              loc=(x + 520, y + 140)), loc=(x + 680, y + 140)),
                  _math(nt, "SUBTRACT", radial, BAND_RADIUS, loc=(x + 1000, y)),
                  loc=(x + 1160, y + 70))
        band = _math(nt, "SUBTRACT",
                     _math(nt, "SUBTRACT", MARK_BAND_HALF, d, loc=(x + 1320, y + 70)),
                     penalty, loc=(x + 1480, y + 70))
        s = _math(nt, "MAXIMUM", s, band, loc=(x + 1640, 700 - i * 120))

    # Threshold the union at zero. The window is +/- 0.7 mm of real surface, so
    # the edge anti-aliases in well under a pixel at this framing.
    r = nt.nodes.new("ShaderNodeMapRange")
    r.location = (x + 1820, 700)
    r.clamp = True
    r.inputs["From Min"].default_value = -0.0007
    r.inputs["From Max"].default_value = 0.0007
    nt.links.new(s, r.inputs["Value"])
    return r.outputs["Result"]


def _mark_field(d, half):
    """Linear insideness for a mark: 1 well inside, exactly 0.5 at `d == half`.

    The shader thresholds this attribute at 0.5 and Blender interpolates it
    linearly across each face, so a field that is itself linear in the distance
    puts the reconstructed edge at the true half-width no matter where the
    vertices fall. That is the whole trick, and the reason a 9 mm line survives
    on a mesh whose vertices are further apart than 9 mm.

    The previous formulation multiplied smoothsteps, which PLATEAUS at 1.0
    across the middle of the line. A vertex landing on the centreline then
    spread that plateau over every face touching it, while a line passing
    cleanly between two vertices never reached the threshold at all - so the
    rendered width tracked the mesh instead of the geometry. That is what made
    the trunk axis dagger-shaped and the pelvis line stepped.
    """
    return max(0.0, min(1.0, (half + MARK_FEATHER - d) / (2.0 * MARK_FEATHER)))


def paint_garments(body, rig, body_only=False):
    """Prepare the body guide shader and the historical garment-mask attributes.

    The current builder uses body_only=True and separate weighted garments.
    The former painted-clothing shader is retained for reproducing historical
    variants; it has no fabric thickness or connected shoulder panels.
    """
    B, rm, mw = rig.data.bones, rig.matrix_world, body.matrix_world

    def head(n):
        return rm @ B[n].head_local

    clav_z = head("clavicle_l").z
    pelvis_z = head("pelvis").z
    thigh_z = head("thigh_l").z
    knee_z = head("calf_l").z
    shoulders = [head("upperarm_l"), head("upperarm_r")]
    hem_z = thigh_z - (thigh_z - knee_z) * 0.46
    armhole = 0.072                       # bares the acromion, keeps a strap medially
    # The arm is separated from the torso by distance to the ARM AXIS, not by a
    # plain x threshold: the ribcage is as wide as the hanging arm's inner edge,
    # so any vertical seam either clips the torso or paints the arm.
    # Extend the axis PAST the wrist, or the hand falls outside the capsule and
    # gets painted: beyond the segment end the nearest point is the wrist, and
    # the fingertips are further from it than the capsule radius.
    arm_axes = []
    for s in ("l", "r"):
        a = head(f"upperarm_{s}")
        w = head(f"hand_{s}") if f"hand_{s}" in B else head(f"lowerarm_{s}")
        arm_axes.append((a, w + (w - a).normalized() * 0.28))
    ARM_R = 0.082

    def dist_to_arm(q):
        best = 1e9
        for a, b in arm_axes:
            ab = b - a
            denom = ab.length_squared
            u = 0.0 if denom < 1e-9 else max(0.0, min(1.0, (q - a).dot(ab) / denom))
            best = min(best, (q - (a + ab * u)).length)
        return best
    FEATHER = 0.004

    all_bones = {b.name for b in rig.data.bones}
    arm_pref = ("upperarm", "lowerarm", "hand", "index", "middle", "pinky", "ring", "thumb")
    leg_pref = ("calf", "foot", "ball", "toe")
    arm_bones = {b for b in all_bones if b.lower().startswith(arm_pref)}
    leg_bones = {b for b in all_bones if b.lower().startswith(leg_pref)}
    gnames = {g.index: g.name for g in body.vertex_groups}

    def wsum(v, bones):
        return sum(g.weight for g in v.groups if gnames.get(g.group) in bones)

    me = body.data
    top_attr = me.attributes.get("top") or me.attributes.new("top", "FLOAT", "POINT")
    sh_attr = me.attributes.get("shorts") or me.attributes.new("shorts", "FLOAT", "POINT")
    # The marks are no longer a baked float - the shader evaluates them from
    # these two instead. `rest_co` is the rest position, which interpolates
    # exactly across a face; `armw` is the arm weight the band gate needs, and
    # it is only ever sampled far from a mark boundary, so vertex resolution is
    # ample for it.
    co_attr = (me.attributes.get("rest_co")
               or me.attributes.new("rest_co", "FLOAT_VECTOR", "POINT"))
    aw_attr = me.attributes.get("armw") or me.attributes.new("armw", "FLOAT", "POINT")

    top_n = shorts_n = 0
    top_vals = [0.0] * len(me.vertices)
    shorts_vals = [0.0] * len(me.vertices)
    mark_vals = [0.0] * len(me.vertices)
    rest_vals = [(0.0, 0.0, 0.0)] * len(me.vertices)
    armw_vals = [0.0] * len(me.vertices)
    band_arm_r = []
    band_torso_r = []
    waist_z = pelvis_z + (clav_z - pelvis_z) * 0.22
    chest_z = pelvis_z + (clav_z - pelvis_z) * 0.74
    for v in me.vertices:
        w = mw @ v.co
        arm_w = wsum(v, arm_bones)
        leg_w = wsum(v, leg_bones)

        # The armhole and the side seam are GEOMETRIC. Gating on vertex weight
        # gives an organic, blotchy edge around the armpit, because weights vary
        # irregularly there - it reads as a stain rather than as a neckline.
        top = (_smoothstep(pelvis_z - 0.022, pelvis_z - 0.014, w.z)
               * (1.0 - _smoothstep(clav_z + 0.026, clav_z + 0.034, w.z))
               # Weight, not proximity: at rest the arm hangs against the ribs,
               # so any capsule around it also eats the flank. A NARROW ramp
               # well inside the arm keeps the edge crisp - the wide 0.04-0.09
               # ramp tried earlier is what made it blotchy.
               * (1.0 - _smoothstep(0.25, 0.45, arm_w)))
        near = min((w - s).length for s in shoulders)
        top *= _smoothstep(armhole - FEATHER, armhole + FEATHER, near)

        shorts = (_smoothstep(hem_z - FEATHER, hem_z + FEATHER, w.z)
                  * (1.0 - _smoothstep(pelvis_z + 0.078, pelvis_z + 0.088, w.z))
                  * (1.0 - _smoothstep(0.20, 0.40, leg_w))
                  * (1.0 - _smoothstep(0.01, 0.04, arm_w)))

        # The three measured references, drawn ON the figure: an acromion band
        # round each deltoid, the trunk axis and the pelvis line. They ride the
        # body, so a shrug lifts the bands - which is what makes it legible.
        #
        # Each is a DISTANCE to a geometric primitive, fed through _mark_field.
        # Combining with max() on the field is the same as min() on the
        # distances, which is the standard union of signed distance functions,
        # so the union stays linear everywhere except at the seams between two
        # marks - and no two marks touch.
        mark = 0.0

        # Acromion band: a ring round each deltoid, bounded BOTH along the arm
        # and radially away from its axis, and gated on arm weight. The old
        # version bounded only `radial < 0.085`. At rest the arm hangs against
        # the ribs, so that capsule also swallowed the chest wall beside it -
        # invisible while the arm covered it, and revealed as two mint islands
        # on the chest the moment the arm abducted away. Bounding radially
        # turns the capsule into a ring that stays on the limb.
        for a, b in arm_axes:
            ab = b - a
            denom = ab.length_squared
            if denom < 1e-9:
                continue
            u = (w - a).dot(ab) / denom
            radial = (w - (a + ab * u)).length
            along = u * ab.length
            # Everything in the band's slab, arm or not, feeds the separation
            # check printed below; only arm vertices are actually painted.
            if abs(along - BAND_ALONG) < MARK_BAND_HALF:
                (band_arm_r if arm_w > 0.45 else band_torso_r).append(radial)
            if arm_w > 0.45:
                d = max(abs(along - BAND_ALONG), radial - BAND_RADIUS)
                mark = max(mark, _mark_field(d, MARK_BAND_HALF))

        # Trunk axis: a rectangle SDF down the front centreline. max() of the
        # three bounds gives square ends; the old product of z-ramps faded out
        # gradually at top and bottom, which is why it tapered to a point.
        if w.y < 0.0:
            d = max(abs(w.x), waist_z - w.z, w.z - chest_z)
            mark = max(mark, _mark_field(d, MARK_AXIS_HALF))

        # Pelvis line: wraps the body at the pelvis.
        mark = max(mark, _mark_field(abs(w.z - pelvis_z), MARK_PELVIS_HALF))

        top_vals[v.index] = top
        shorts_vals[v.index] = shorts
        mark_vals[v.index] = mark
        rest_vals[v.index] = (w.x, w.y, w.z)
        armw_vals[v.index] = arm_w

    # Blur the mask across the mesh before the shader thresholds it. Sharpening
    # a raw mask exposes its vertex-level noise as a wobbly hem; a few averaging
    # passes remove that high frequency while leaving the overall shape, so the
    # threshold lands on a smooth curve.
    adj = {i: [] for i in range(len(me.vertices))}
    for e in me.edges:
        a, b = e.vertices
        adj[a].append(b)
        adj[b].append(a)
    for _ in range(5):
        for vals in (top_vals, shorts_vals):
            blurred = list(vals)
            for i, ns in adj.items():
                if ns:
                    blurred[i] = 0.45 * vals[i] + 0.55 * (sum(vals[n] for n in ns) / len(ns))
            vals[:] = blurred

    # The marks are NOT blurred. The garment masks are binary regions whose raw
    # per-vertex edge is genuinely noisy, so averaging helps them. The mark field
    # is already smooth and, more to the point, linear: blurring it would round
    # the square ends of the trunk axis and pull the whole boundary inward off
    # the half-width it was built to hold. The earlier single pass existed to
    # hide the plateau formulation's vertex noise, and that noise is now gone at
    # source.
    #
    # The band's whole job is to stay on the arm. Measure the separation rather
    # than trust it: within the band's slab, report how far out the arm surface
    # reaches and how close the nearest NON-arm vertex comes. The old capsule
    # used radius 0.085 with no radial bound at all, which is why it caught the
    # chest wall the hanging arm was resting against.
    if band_arm_r and band_torso_r:
        def pct(xs, q):
            s = sorted(xs)
            return s[min(len(s) - 1, int(len(s) * q))]
        paint_to = BAND_RADIUS + MARK_BAND_HALF
        print("MARKS band arm_radial p50={:.4f} p75={:.4f} p90={:.4f} p99={:.4f} max={:.4f} "
              "n={}".format(pct(band_arm_r, .50), pct(band_arm_r, .75), pct(band_arm_r, .90),
                            pct(band_arm_r, .99), max(band_arm_r), len(band_arm_r)), flush=True)
        print("MARKS band non_arm_radial min={:.4f} p01={:.4f} p10={:.4f} p25={:.4f} "
              "n={}".format(min(band_torso_r), pct(band_torso_r, .01), pct(band_torso_r, .10),
                            pct(band_torso_r, .25), len(band_torso_r)), flush=True)
        print(f"MARKS band radius={BAND_RADIUS:.4f} paints_out_to={paint_to:.4f}", flush=True)
        if max(band_arm_r) > BAND_RADIUS:
            print(f"MARKS NOTE the arm reaches {max(band_arm_r):.4f}, past the "
                  f"{BAND_RADIUS:.4f} radial bound; the ring is closed by the arm-weight "
                  f"gate rather than by the radius", flush=True)
        if min(band_torso_r) < paint_to:
            print(f"MARKS NOTE a non-arm vertex sits at {min(band_torso_r):.4f}, inside the "
                  f"{paint_to:.4f} the band paints out to - the arm-weight gate, not the "
                  f"radial bound, is what excludes the torso here", flush=True)
    print(f"MARKS inside={sum(1 for m in mark_vals if m > 0.5)} vertices "
          f"(sanity count only; the shader evaluates the marks per pixel)", flush=True)

    for i in range(len(me.vertices)):
        top_attr.data[i].value = top_vals[i]
        sh_attr.data[i].value = shorts_vals[i]
        co_attr.data[i].vector = rest_vals[i]
        aw_attr.data[i].value = armw_vals[i]
        top_n += top_vals[i] > 0.5
        shorts_n += shorts_vals[i] > 0.5

    # One material, two attribute-driven mixes.
    mat = bpy.data.materials.new("Figure_Painted")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.80
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.16

    def attr_mix(name, colour, into, x, strength=1.0, lo=0.47, hi=0.53):
        a = nt.nodes.new("ShaderNodeAttribute")
        a.attribute_name = name
        a.location = (x, 300)
        # Sharpen the boundary in the SHADER. The mask is a per-vertex value, so
        # its softness is bounded by vertex spacing - but it interpolates across
        # each face, so thresholding it here puts the hem anywhere within a face
        # and gives a crisp edge far finer than the mesh resolution. The narrow
        # band that survives is deliberate: it anti-aliases the seam.
        r = nt.nodes.new("ShaderNodeMapRange")
        r.location = (x + 170, 320)
        r.clamp = True
        r.inputs["From Min"].default_value = lo
        r.inputs["From Max"].default_value = hi
        nt.links.new(a.outputs["Fac"], r.inputs["Value"])
        m = nt.nodes.new("ShaderNodeMixRGB")
        m.blend_type = "MIX"
        m.location = (x + 340, 200)
        m.inputs[2].default_value = colour
        if strength < 1.0:
            s = nt.nodes.new("ShaderNodeMath")
            s.operation = "MULTIPLY"
            s.location = (x + 250, 380)
            s.inputs[1].default_value = strength
            nt.links.new(r.outputs["Result"], s.inputs[0])
            nt.links.new(s.outputs[0], m.inputs[0])
        else:
            nt.links.new(r.outputs["Result"], m.inputs[0])
        nt.links.new(into, m.inputs[1])
        return m.outputs[0]

    base = nt.nodes.new("ShaderNodeRGB")
    base.outputs[0].default_value = BODY_RGBA
    base.location = (-700, 100)
    out = base.outputs[0]
    if not body_only:
        out = attr_mix("top", TOP_RGBA, out, -900)
        out = attr_mix("shorts", SHORT_RGBA, out, -400)

    # The garments stay per-vertex: they are large regions whose boundary the
    # mesh resolves easily. The marks are thin lines and do not, so they are
    # evaluated per pixel from the baked rest position instead.
    mark_fac = build_mark_sdf(nt, arm_axes, waist_z, chest_z, pelvis_z)

    mm = nt.nodes.new("ShaderNodeMixRGB")
    mm.blend_type = "MIX"
    mm.location = (2000, 200)
    mm.inputs[2].default_value = MARK_RGBA
    nt.links.new(_math(nt, "MULTIPLY", mark_fac, 0.55, loc=(1900, 380)), mm.inputs[0])
    nt.links.new(out, mm.inputs[1])
    nt.links.new(mm.outputs[0], bsdf.inputs["Base Color"])

    # Make the marks self-illuminate, from the SAME mask that colours them, so
    # the glow cannot drift off the band. Because it is emission the marks stay
    # legible wherever the key light does not reach, which is the point of
    # marking a landmark at all.
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = MARK_GLOW
        nt.links.new(_math(nt, "MULTIPLY", mark_fac, MARK_GLOW_STRENGTH, loc=(2000, 480)),
                     bsdf.inputs["Emission Strength"])

    me.materials.clear()
    me.materials.append(mat)
    for poly in me.polygons:
        poly.material_index = 0
    return top_n, shorts_n


def add_landmarks(body, rig, mark_mat) -> int:
    """Acromion bands, trunk axis and pelvis line, joined into the body so the
    existing armature weights carry them."""
    B = rig.data.bones
    rm = rig.matrix_world
    made = []

    def bone(*cands):
        for c in cands:
            if c in B:
                return B[c]
        return None

    for side, sign in (("l", 1.0), ("r", -1.0)):
        ua = bone(f"upperarm_{side}", f"upper_arm_{side}")
        head = rm @ ua.head_local
        tail = rm @ ua.tail_local
        pos = head + (tail - head) * 0.24
        r = (tail - head).length * 0.20
        bpy.ops.mesh.primitive_torus_add(location=pos, major_radius=r,
                                         minor_radius=r * 0.11,
                                         major_segments=32, minor_segments=8)
        made.append(bpy.context.active_object)

    pelvis = bone("pelvis", "hips", "spine_01")
    spine = bone("spine_03", "spine_02", "spine_01")
    if pelvis is not None:
        p = rm @ pelvis.head_local
        bpy.ops.mesh.primitive_torus_add(location=(0.0, p.y, p.z),
                                         major_radius=0.150, minor_radius=0.010,
                                         major_segments=40, minor_segments=8)
        made.append(bpy.context.active_object)
    if spine is not None and pelvis is not None:
        a = rm @ spine.head_local
        b = rm @ pelvis.head_local
        mid = (a + b) / 2.0
        bpy.ops.mesh.primitive_cube_add(location=(0.0, mid.y - 0.105, mid.z))
        o = bpy.context.active_object
        o.scale = (0.009, 0.007, (a.z - b.z) * 0.30)
        made.append(o)

    for o in made:
        o.data.materials.append(mark_mat)
    bpy.ops.object.select_all(action="DESELECT")
    for o in made:
        o.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    return len(made)


def build_studio(scene, body, rig):
    for o in [x for x in bpy.data.objects if x.type in {"LIGHT", "CAMERA"}
              or x.name == "Floor" or x.name.startswith("Preview ")]:
        bpy.data.objects.remove(o, do_unlink=True)

    scene.frame_set(FRAME_START)

    dg = bpy.context.evaluated_depsgraph_get()
    me = body.evaluated_get(dg).to_mesh()
    pts = [body.matrix_world @ v.co for v in me.vertices]
    head_top = max(p.z for p in pts)
    foot_z = min(p.z for p in pts)
    body.evaluated_get(dg).to_mesh_clear()
    stature = head_top - foot_z

    bpy.ops.mesh.primitive_plane_add(size=14.0, location=(0, 0, foot_z))
    bpy.context.active_object.name = "Floor"
    bpy.context.active_object.data.materials.append(
        flat_material("Floor", (0.206, 0.196, 0.178, 1.0), 0.94))

    aim = Vector((0.0, 0.0, foot_z + stature * 0.72))
    for name, energy, size, loc in (("Key", 240.0, 4.2, (-1.6, -3.6, 2.8)),
                                    ("Fill", 158.0, 5.2, (2.3, -3.1, 1.8)),
                                    ("Top", 88.0, 3.0, (0.0, -0.7, 3.8))):
        d = bpy.data.lights.new(name, "AREA")
        d.energy, d.size, d.shape = energy, size, "SQUARE"
        # EEVEE's unjittered shadow maps produce angular hand-shadow patches
        # over the shorts. Sample the actual area light for soft shadows.
        # Geometry/subdivision is deliberately unchanged, retaining clean guides.
        d.use_shadow_jitter = True
        o = bpy.data.objects.new(name, d)
        o.location = loc
        o.rotation_euler = (aim - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(o)

    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.128, 0.122, 0.110, 1.0)
        bg.inputs["Strength"].default_value = 1.1

    # EEVEE Next has no built-in bloom; the halo comes from a compositor glare.
    # No compositor bloom. Blender 5.x compositing is a node group with no
    # Composite output node, and feeding it from the group input rendered pure
    # white - the render result does not arrive on that socket the way it does
    # in the old tree. The marks are emissive in the material instead, which is
    # what actually carries the legibility; a halo would only be decoration.
    scene.use_nodes = False
    scene.compositing_node_group = None

    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 52.0
    cam_data.sensor_fit = "VERTICAL"
    cam = bpy.data.objects.new("Camera", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    HEAD_FRAC, FOOT_MARGIN = 0.13, 0.06
    span = stature / (1.0 - HEAD_FRAC - FOOT_MARGIN)
    dist = span / (2.0 * math.tan(math.atan(cam_data.sensor_height / (2.0 * cam_data.lens))))
    top = head_top + HEAD_FRAC * span
    cam.location = (0.0, -dist, top - span / 2.0)
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)

    scene.render.resolution_y = 980
    scene.render.resolution_x = 720
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1.0
    bpy.context.view_layer.update()
    # The former hand-bone estimate omitted fingertips and ignored perspective.
    # Fit the actual skinned surface through the entire animation instead.
    samples = projected_body_bounds(scene, body)
    reach = max(max(abs(s["xmin"] - .5), abs(s["xmax"] - .5)) for s in samples)
    width = max(840, math.ceil(720 * reach / (.5 - FRAME_SIDE_MARGIN)))
    scene.render.resolution_x = width + width % 2  # H.264/yuv420p requires even dimensions.
    ratio = 720 / scene.render.resolution_x
    min_margin = .5 - reach * ratio
    if min_margin < FRAME_SIDE_MARGIN - 1e-6:
        raise RuntimeError("Camera fit did not achieve the requested fingertip margin")
    if min(s["ymin"] for s in samples) < .035 or max(s["ymax"] for s in samples) > .88:
        raise RuntimeError("Figure leaves the vertical body area or enters the title area")
    scene["figure_camera_fit"] = json.dumps({
        "frames_measured": len(samples), "side_margin": min_margin,
        "resolution": [scene.render.resolution_x, scene.render.resolution_y]})

    head_frac = (top - head_top) / span
    if not (0.05 <= head_frac <= 0.25):
        raise RuntimeError(f"Head fraction {head_frac:.3f} outside the gate band")
    return {"stature_m": round(stature, 4), "head_fraction": round(head_frac, 4),
            "camera_distance": round(dist, 4), "minimum_side_margin": round(min_margin, 6),
            "frames_measured": len(samples),
            "resolution": [scene.render.resolution_x, scene.render.resolution_y]}


def main() -> None:
    args = parse_args()
    if args.source:
        bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
        body = bpy.data.objects.get("Figure_Body")
        rig = bpy.data.objects.get("Figure_Rig")
        if body is None or body.type != "MESH" or rig is None or rig.type != "ARMATURE":
            raise RuntimeError("--source must contain Figure_Body and Figure_Rig")
        if body.data.shape_keys is not None:
            raise RuntimeError("--source must have its morphology shape keys baked")
        rig.animation_data_clear()
        for pb in rig.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        for o in list(bpy.data.objects):
            if o not in {body, rig}:
                bpy.data.objects.remove(o, do_unlink=True)
    else:
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)

    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = FRAME_START, FRAME_END
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.frame_set(FRAME_START)
    if not args.source:
        body, rig = generate_human(scene)
    verts = len(body.data.vertices)
    bones = len(rig.data.bones)

    marks = 0
    keys = 0
    top_v = short_v = 0
    framing = {}
    clothing = {}
    if args.stage == "full":
        if not args.source:
            baked = bake_shape_keys(body)
            print(f"BODY baked {baked} shape keys", flush=True)
            flattened = flatten_chest(body, rig)
            print(f"BODY flattened {flattened} chest vertices", flush=True)
        top_v, short_v = paint_garments(body, rig, body_only=True)
        keys = animate(rig, args.girdle_scale)
        framing = build_studio(scene, body, rig)
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from mpfb_clothing import add_clothing
        garments = add_clothing(body, rig)
        clothing = {o.name: {"vertices": len(o.data.vertices), "faces": len(o.data.polygons)}
                    for o in garments}
        print(f"CLOTHING separate weighted garments={len(garments)}", flush=True)
        add_preview_labels(scene)
        scene.render.engine = "BLENDER_EEVEE"
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.use_border = False
        scene.render.use_crop_to_border = False
        scene["figure_revision"] = FIGURE_REVISION
        scene["figure_girdle_scale"] = args.girdle_scale
        scene["figure_hand_pose"] = "hand axis aligned to forearm; inherited palm roll preserved"
        scene["figure_clinical_review"] = "presentation only; hand orientation not clinician-reviewed"
        scene.frame_set(FRAME_START)

    scene.frame_set(96)
    clavicle = rig.pose.bones["clavicle_l"]
    peak_girdle = math.degrees(math.asin((clavicle.tail - clavicle.head).normalized().z))
    scene.frame_set(FRAME_START)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output))
    print("EX001_MPFB=" + json.dumps({
        "output": str(args.output), "stage": args.stage,
        "revision": FIGURE_REVISION,
        "body_verts": verts, "bones": bones, "rig": STANDARD_RIG,
        "landmarks": marks, "keyframes": keys,
        "girdle_scale": args.girdle_scale,
        "girdle_driver_deg_at_peak": round(clavicle_at(PEAK_DEG, args.girdle_scale), 4),
        "measured_girdle_deg_at_peak": round(peak_girdle, 4),
        "garments": clothing, "phenotype": PHENOTYPE,
        **framing,
    }, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
