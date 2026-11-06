"""Author the ex_001 "Ada" patient-facing demonstration figure.

Ada is a separate, clinically-framed alternative to the protected Maya demo.
She reuses Maya's CC0 MakeHuman-derived body, eyes, brows, lashes, teeth,
tongue, 53-bone rig and validated 210-frame action, and changes only what the
demonstration design calls for:

  * the casual suit and shoes are dropped, and the body masks that hid the
    skin beneath them are removed, so the whole figure is visible;
  * a fitted top and shorts are generated FROM THE BODY'S OWN vertex weights,
    so no anatomy is invented and the acromions, shoulder line, trunk axis,
    pelvis and knees all stay readable;
  * hair is trimmed clear of the trapezius, which it otherwise covers;
  * skin is made matte so speculars stop inventing landmarks on the deltoid;
  * lighting is a broad frontal key with heavy fill, so no hard shadow line
    forms under the acromion;
  * the camera is reframed to the capture-readiness geometry the patient is
    actually gated against - head inside the top 5-25% of frame height, knees
    and feet in shot.

The protected Maya source is opened READ-ONLY and never written back.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SOURCE_SHA256 = "BBA7460E1791C11885CDAF5B42D7EF88AB8709D0AD4725EBD6B7489C2C23EEEC"
RIG_NAME = "Maya_Exercise_Rig"
BODY_NAME = "Maya_Body"
ACTION_NAME = "ex_001_lateral_arm_raise"

# Meshes carried over from the protected source.
KEEP = {
    "Maya_Body": "Ada_Body",
    "Maya_high_poly": "Ada_Eyes",
    "Maya_eyebrow001": "Ada_Eyebrows",
    "Maya_eyelashes01": "Ada_Eyelashes",
    "Maya_teeth_base": "Ada_Teeth",
    "Maya_tongue01": "Ada_Tongue",
    "Maya_short03": "Ada_Hair",
}
# Only the shoes are dropped outright: they hide the ankle and add nothing to
# a shoulder movement. The casual suit is KEPT and tailored - it is already a
# fitted, UV-mapped garment, so cutting its sleeves and legs yields a real
# sleeveless top and shorts rather than cloth guessed from the skin surface.
DROP = {"Maya_shoes05"}
SUIT_NAME = "Maya_female_casualsuit01"
SLEEVE_BONES = {"upperarm_l", "upperarm_r", "lowerarm_l", "lowerarm_r"}
BELOW_KNEE_BONES = {"calf_l", "calf_r", "foot_l", "foot_r"}

ARM_BONES = {
    "upperarm_l", "lowerarm_l", "hand_l", "upperarm_r", "lowerarm_r", "hand_r",
}
FINGER_PREFIXES = ("index_", "middle_", "pinky_", "ring_", "thumb_")
LEG_BONES = {"calf_l", "calf_r", "foot_l", "foot_r", "ball_l", "ball_r"}
THIGH_BONES = {"thigh_l", "thigh_r"}
CLAVICLE_BONES = {"clavicle_l", "clavicle_r"}
SPINE_BONES = {"spine_01", "spine_02", "spine_03"}

# The vertex group the "Hide helpers" mask keeps: the real body surface.
BODY_GROUP = "body"

ROOT_COLLECTION = "EX001_Ada"
CHAR_COLLECTION = "EX001_Ada_Character"
STAGE_COLLECTION = "EX001_Ada_Studio"

FRAME_START, FRAME_END, FPS = 1, 210, 30


def blender_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_args() -> argparse.Namespace:
    root = repo_root()
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source", type=Path,
                   default=root / "assets" / "blender" / "ex_001_lateral_arm_raise.blend")
    p.add_argument("--output", type=Path,
                   default=root / "assets" / "blender" / "ex_001_lateral_arm_raise_ada.blend")
    p.add_argument("--skip-hash-check", action="store_true",
                   help="Proceed even if the source hash differs from the recorded one.")
    return p.parse_args(blender_args())


def sha256(path: Path) -> str:
    d = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            d.update(chunk)
    return d.hexdigest().upper()


def weight_map(obj: bpy.types.Object) -> tuple[list[dict[str, float]], dict[int, str]]:
    """Per-vertex {bone_name: weight}, plus the group-index -> name table."""
    names = {g.index: g.name for g in obj.vertex_groups}
    rows: list[dict[str, float]] = []
    for v in obj.data.vertices:
        rows.append({names[g.group]: g.weight for g in v.groups if g.group in names})
    return rows, names


def group_weight(w: dict[str, float], bones) -> float:
    return sum(v for k, v in w.items() if k in bones)


def finger_weight(w: dict[str, float]) -> float:
    return sum(v for k, v in w.items() if k.startswith(FINGER_PREFIXES))


def dominant_group(v, names) -> str:
    if not v.groups:
        return ""
    g = max(v.groups, key=lambda x: x.weight)
    return names.get(g.group, "")


def tailor_suit(suit, rig, hem_z: float, armhole_offset: float = 0.012) -> dict:
    """Cut the sleeves off at the shoulder and the legs off above the knee.

    The cuts BISECT the mesh along a plane rather than deleting whole vertices.
    Deleting vertices leaves the rim stair-stepped along the garment's own
    topology, which on a 2k-vertex suit is very visible; bisecting lays a new
    edge loop exactly on the plane and gives a clean hem.

    Nothing is modelled here: only existing garment geometry is cut away, so
    what remains keeps its original fit, UVs and normal map.
    """
    import bmesh

    mw = suit.matrix_world
    inv = mw.inverted()
    rm = rig.matrix_world
    B = rig.data.bones

    # Lateral cut, not one along the arm axis: the upper arm slopes downward,
    # so a plane normal to it also swallows the hips.
    shoulder_x = max(abs((rm @ B[f"upperarm_{s}"].head_local).x) for s in ("l", "r"))
    armhole_x = shoulder_x + armhole_offset

    before = len(suit.data.vertices)
    bm = bmesh.new()
    bm.from_mesh(suit.data)

    cuts = (
        ((armhole_x, 0.0, 0.0), (1.0, 0.0, 0.0)),    # left sleeve
        ((-armhole_x, 0.0, 0.0), (-1.0, 0.0, 0.0)),  # right sleeve
        ((0.0, 0.0, hem_z), (0.0, 0.0, -1.0)),       # trouser legs
    )
    for co_world, no_world in cuts:
        co = inv @ Vector(co_world)
        no = (inv.to_3x3() @ Vector(no_world)).normalized()
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6,
                               plane_co=co, plane_no=no, clear_outer=True)

    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(suit.data)
    bm.free()
    suit.data.update()
    return {"removed": before - len(suit.data.vertices),
            "remaining": len(suit.data.vertices),
            "loose_stripped": len(loose),
            "armhole_x": round(armhole_x, 4)}


def split_shorts_material(suit, shorts_mat, waist_z: float) -> int:
    """Give the below-waist faces their own flat material, so the top and the
    shorts read as two garments separated in value."""
    suit.data.materials.append(shorts_mat)
    slot = len(suit.data.materials) - 1
    mw = suit.matrix_world
    n = 0
    for poly in suit.data.polygons:
        centre = sum(((mw @ suit.data.vertices[i].co) for i in poly.vertices), Vector()) / len(poly.vertices)
        if centre.z < waist_z:
            poly.material_index = slot
            n += 1
    return n


def matte_skin(mat: bpy.types.Material) -> None:
    """Kill the specular highlight that reads as bone on a deltoid."""
    if not mat or not mat.use_nodes:
        return
    for node in mat.node_tree.nodes:
        if node.type == "BSDF_PRINCIPLED":
            for key, value in (("Roughness", 0.72), ("Specular IOR Level", 0.18),
                               ("Sheen Weight", 0.0), ("Coat Weight", 0.0),
                               ("Metallic", 0.0)):
                if key in node.inputs and not node.inputs[key].is_linked:
                    node.inputs[key].default_value = value


def flat_material(name: str, rgba: tuple[float, float, float, float], rough: float) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.2
    return mat


def area_light(name, energy, size, loc, target, collection):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.size = size
    data.shape = "SQUARE"
    obj = bpy.data.objects.new(name, data)
    obj.location = loc
    direction = (Vector(target) - Vector(loc)).normalized()
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    collection.objects.link(obj)
    return obj


def main() -> None:
    args = parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Protected source not found: {source}")

    source_hash = sha256(source)
    if not args.skip_hash_check and not source_hash.startswith(SOURCE_SHA256[:16]):
        raise RuntimeError(
            f"Protected Maya hash changed: {source_hash} (expected prefix {SOURCE_SHA256[:16]})"
        )

    print(f"ADA opening protected source read-only: {source}", flush=True)
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False)

    rig = bpy.data.objects.get(RIG_NAME)
    body = bpy.data.objects.get(BODY_NAME)
    if rig is None or body is None:
        raise RuntimeError("Protected source is missing the rig or body")

    # --- drop what conceals the measurement -------------------------------
    for name in DROP:
        obj = bpy.data.objects.get(name)
        if obj is not None:
            bpy.data.objects.remove(obj, do_unlink=True)
            print(f"ADA dropped {name}", flush=True)

    # The body was masked away beneath the suit; with the suit gone the masks
    # would leave holes in the torso and legs.
    # Only the garment-delete masks go. "Hide helpers" keeps the visible mesh
    # restricted to the real body: without it MakeHuman's proxy shells (a skirt
    # helper, a face helper) render as geometry over the figure.
    removed_masks = []
    for m in list(body.modifiers):
        if m.type == "MASK" and m.name == "Delete.shoes05":
            removed_masks.append(m.name)
            body.modifiers.remove(m)
    kept_masks = [m.name for m in body.modifiers if m.type == "MASK"]
    if "Hide helpers" not in kept_masks:
        raise RuntimeError("The 'Hide helpers' mask must be retained")
    print(f"ADA removed masks={removed_masks} kept={kept_masks}", flush=True)

    # --- measurements used for garment cuts and framing -------------------
    depsgraph = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(depsgraph)
    me = ev.to_mesh()
    world = [body.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    head_top = max(p.z for p in world)
    foot_z = min(p.z for p in world)
    stature = head_top - foot_z

    bones = rig.data.bones
    clav_z = (rig.matrix_world @ bones["clavicle_l"].head_local).z
    pelvis_z = (rig.matrix_world @ bones["pelvis"].head_local).z
    thigh_z = (rig.matrix_world @ bones["thigh_l"].head_local).z
    calf_z = (rig.matrix_world @ bones["calf_l"].head_local).z
    knee_z = calf_z
    neck_z = (rig.matrix_world @ bones["neck_01"].head_local).z
    print(f"ADA stature={stature:.3f} head={head_top:.3f} clav={clav_z:.3f} "
          f"pelvis={pelvis_z:.3f} thigh={thigh_z:.3f} knee={knee_z:.3f}", flush=True)

    mw = body.matrix_world

    # --- materials --------------------------------------------------------
    matte_skin(bpy.data.materials.get("Maya_Body.body"))
    short_mat = flat_material("Ada_Shorts", (0.086, 0.098, 0.110, 1.0), 0.86)

    # --- tailor the existing garment ---------------------------------------
    suit = bpy.data.objects.get(SUIT_NAME)
    if suit is None:
        raise RuntimeError("Protected source is missing its casual suit")
    hem_z = thigh_z - (thigh_z - knee_z) * 0.42     # mid-thigh hem
    waist_z = pelvis_z + 0.02
    cut = tailor_suit(suit, rig, hem_z)
    shorts_faces = split_shorts_material(suit, short_mat, waist_z)
    # A cut edge shows the cloth's backface as a torn rim; solidify gives the
    # armhole and hem a real thickness so they read as finished seams.
    hemmed = suit.modifiers.new("Hem", "SOLIDIFY")
    hemmed.thickness = 0.005
    hemmed.offset = 0.0
    hemmed.use_rim = True
    while suit.modifiers.find("Hem") > 0:
        with bpy.context.temp_override(object=suit):
            bpy.ops.object.modifier_move_up(modifier="Hem")

    # Flat garment colour: the shirt's printed graphic pulls the eye off the
    # shoulder line, which is the one thing this figure exists to show. The
    # fabric normal map is kept, only the base colour is overridden.
    suit_mat = suit.data.materials[0] if suit.data.materials else None
    if suit_mat and suit_mat.use_nodes:
        bsdf = next((n for n in suit_mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            bc = bsdf.inputs["Base Color"]
            for link in list(bc.links):
                suit_mat.node_tree.links.remove(link)
            bc.default_value = (0.135, 0.262, 0.238, 1.0)
            bsdf.inputs["Roughness"].default_value = 0.86
            if "Specular IOR Level" in bsdf.inputs:
                bsdf.inputs["Specular IOR Level"].default_value = 0.18

    suit.name = "Ada_Athleticwear"
    suit["ada_derivation"] = "Maya casual suit with sleeves and trouser legs deleted"
    print(f"ADA suit cut removed={cut['removed']} remaining={cut['remaining']} "
          f"hem_z={hem_z:.3f} armhole_x={cut['armhole_x']} shorts_faces={shorts_faces}", flush=True)

    # --- restore the skin the tailoring exposed ----------------------------
    # MakeHuman deletes the body beneath a garment so cloth cannot clip through
    # it. The suit's delete mask is KEPT so that stays true under the remaining
    # top and shorts; it is only pruned where the sleeves and legs were cut,
    # otherwise the bare arms and calves would be holes.
    del_vg = body.vertex_groups.get("Delete.female_casualsuit01")
    restored = 0
    if del_vg is not None:
        bone_names = {b.name for b in rig.data.bones}
        vnames = {g.index: g.name for g in body.vertex_groups}
        expose = SLEEVE_BONES | BELOW_KNEE_BONES | {"hand_l", "hand_r"}
        keep_idx = []
        for v in body.data.vertices:
            if not any(g.group == del_vg.index for g in v.groups):
                continue
            bone_groups = [g for g in v.groups if vnames.get(g.group) in bone_names]
            dom = vnames[max(bone_groups, key=lambda x: x.weight).group] if bone_groups else ""
            z = (mw @ v.co).z
            if dom in expose or dom.startswith(FINGER_PREFIXES) or z < hem_z:
                keep_idx.append(v.index)
        if keep_idx:
            del_vg.remove(keep_idx)
            restored = len(keep_idx)
    print(f"ADA restored {restored} body verts where the cloth was cut", flush=True)

    # --- hair trimmed clear of the trapezius -------------------------------
    hair = bpy.data.objects.get("Maya_short03")
    hair_removed = 0
    if hair is not None:
        hair_cut_z = clav_z + 0.035
        hm = hair.data
        doomed = [v.index for v in hm.vertices if (hair.matrix_world @ v.co).z < hair_cut_z]
        hair_removed = len(doomed)
        if doomed:
            import bmesh
            bm = bmesh.new()
            bm.from_mesh(hm)
            bm.verts.ensure_lookup_table()
            bmesh.ops.delete(bm, geom=[bm.verts[i] for i in doomed], context="VERTS")
            bm.to_mesh(hm)
            bm.free()
        print(f"ADA hair trimmed {hair_removed} verts below z={hair_cut_z:.3f}", flush=True)

    # --- rename into the Ada namespace -------------------------------------
    for old, new in KEEP.items():
        obj = bpy.data.objects.get(old)
        if obj is not None:
            obj.name = new
    rig.name = "Ada_Exercise_Rig"

    # --- studio: broad frontal key, heavy fill, no hard acromion shadow ----
    for light in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(light, do_unlink=True)
    stage = bpy.data.collections.get("EX001_Studio") or bpy.context.scene.collection
    aim = (0.0, 0.0, clav_z)
    area_light("Ada_Key", 900.0, 4.0, (-1.5, -3.6, 2.7), aim, stage)
    area_light("Ada_Fill", 620.0, 5.0, (2.2, -3.2, 1.7), aim, stage)
    area_light("Ada_Top", 380.0, 3.0, (0.0, -0.6, 3.6), aim, stage)

    scene = bpy.context.scene
    scene.render.resolution_x = 720
    scene.render.resolution_y = 960          # upright, like a standing patient
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = FRAME_START, FRAME_END
    if scene.world and scene.world.use_nodes:
        bg = scene.world.node_tree.nodes.get("Background")
        if bg:
            bg.inputs["Color"].default_value = (0.128, 0.122, 0.108, 1.0)
            bg.inputs["Strength"].default_value = 1.15

    floor = bpy.data.objects.get("Studio Floor")
    if floor is not None and floor.data.materials:
        fm = floor.data.materials[0]
        if fm.use_nodes:
            b = fm.node_tree.nodes.get("Principled BSDF")
            if b:
                b.inputs["Base Color"].default_value = (0.20, 0.19, 0.17, 1.0)
                b.inputs["Roughness"].default_value = 0.94

    # --- camera matched to the capture-readiness geometry ------------------
    cam = bpy.data.objects.get("EX001_Camera")
    if cam is None:
        raise RuntimeError("Protected source is missing its camera")
    cam.name = "Ada_Camera"
    cam.data.lens = 52.0
    cam.data.sensor_fit = "VERTICAL"
    sensor_v = cam.data.sensor_height
    # Head sits at HEAD_FRAC of frame height from the top; feet stay in shot.
    HEAD_FRAC = 0.13
    FOOT_MARGIN = 0.06
    span = (head_top - foot_z) / (1.0 - HEAD_FRAC - FOOT_MARGIN)
    distance = span / (2.0 * math.tan(math.atan(sensor_v / (2.0 * cam.data.lens))))
    top_of_frame = head_top + HEAD_FRAC * span
    cam_z = top_of_frame - span / 2.0
    cam.location = (0.0, -distance, cam_z)
    cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    scene.camera = cam

    head_frac = (top_of_frame - head_top) / span
    knee_frac = (top_of_frame - knee_z) / span
    foot_frac = (top_of_frame - foot_z) / span
    print(f"ADA camera dist={distance:.3f} z={cam_z:.3f} span={span:.3f} "
          f"head_frac={head_frac:.3f} knee_frac={knee_frac:.3f} foot_frac={foot_frac:.3f}",
          flush=True)
    if not (0.05 <= head_frac <= 0.25):
        raise RuntimeError(f"Head fraction {head_frac:.3f} outside the gate band 0.05-0.25")
    if foot_frac >= 1.0:
        raise RuntimeError("Feet fall outside the frame")

    # --- provenance --------------------------------------------------------
    root = bpy.data.collections.get(ROOT_COLLECTION)
    if root is None:
        root = bpy.data.collections.new(ROOT_COLLECTION)
        scene.collection.children.link(root)
    root["asset_family"] = "ex_001 Ada patient-facing demonstration"
    root["derived_from"] = "ex_001_lateral_arm_raise.blend (Maya)"
    root["source_sha256"] = source_hash
    root["body_origin"] = "CC0 MakeHuman system assets, via the Maya build"
    root["garments"] = "generated from body vertex weights; no sculpted geometry"
    root["medical_claim"] = "instructional demonstration; not clinically validated"
    root["head_fraction"] = head_frac
    root["knee_fraction"] = knee_frac
    root["stature_m"] = stature

    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)

    print("EX001_ADA_BUILD=" + json.dumps({
        "output": str(output),
        "source_hash": source_hash,
        "stature_m": round(stature, 4),
        "suit_removed": cut["removed"],
        "suit_remaining": cut["remaining"],
        "shorts_faces": shorts_faces,
        "loose_stripped": cut["loose_stripped"],
        "hair_trimmed": hair_removed,
        "skin_restored": restored,
        "masks_removed": removed_masks,
        "head_fraction": round(head_frac, 4),
        "knee_fraction": round(knee_frac, 4),
        "foot_fraction": round(foot_frac, 4),
        "camera_distance": round(distance, 4),
    }, sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
