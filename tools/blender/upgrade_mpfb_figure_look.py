"""Give a saved MPFB figure scene its upgraded presentation look.

Adds a CC0 MakeHuman hairstyle fitted to the saved body, softens the skin with
subsurface scattering, rebalances the studio lights, and replaces the flat
floor and its hard horizon with a seamless studio backdrop. EEVEE ray tracing
stays off: at full size it added about a quarter to each frame's render time
for barely visible contact shading. Body, garment and rig
data, the animation, the camera and the girdle settings are unchanged, and the
source file is never written. Presentation only: none of these choices is a
clinical or anatomical claim.

The hair is fitted the way MPFB fits MakeHuman clothes: each hair vertex is a
weighted sum of three body vertices plus an offset scaled by the body's own
proportions (see MPFB's ClothesService.fit_clothes_to_human). It then follows
the head bone rigidly. Its texture is packed into the output file.

    blender --background --factory-startup --disable-autoexec --python-exit-code 1 `
      --python tools/blender/upgrade_mpfb_figure_look.py -- `
      --source assets/blender/ex_001_figure_mpfb.blend `
      --hair-dir <MPFB user data>/hair/short02 --output <fresh .blend>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

LOOK_REVISION = "mpfb-look-2026-09-25"
MESH_NAMES = ("Figure_Body", "Figure_Top", "Figure_Shorts")
SKIN_SUBSURFACE = (0.25, (1.0, 0.36, 0.20), 0.012)  # weight, radius, scale in metres
SKIN_ROUGHNESS, SKIN_SPECULAR = 0.58, 0.20   # stays matte so no highlight reads as a landmark
HAIR_TINT = (0.30, 0.24, 0.19, 1.0)          # multiplies the CC0 texture toward a neutral dark brown
# Colour palettes: skin; top and shorts as (fabric, trim); backdrop; label text
# (None keeps the source's light labels). Both give the skin and the clothes a
# clear luminance step from the background, one against a dark studio and one
# against a light one. The landmark marks keep their own glowing colour.
PALETTES = {
    "mid": {"skin": (0.400, 0.305, 0.250, 1.0),
            "top": ((0.108, 0.227, 0.204, 1.0), (0.069, 0.150, 0.133, 1.0)),
            "shorts": ((0.100, 0.111, 0.128, 1.0), (0.067, 0.076, 0.091, 1.0)),
            "backdrop": (0.200, 0.196, 0.186, 1.0), "text": None},
    "dark": {"skin": (0.400, 0.305, 0.250, 1.0),
             "top": ((0.100, 0.360, 0.310, 1.0), (0.060, 0.240, 0.200, 1.0)),
             "shorts": ((0.260, 0.270, 0.290, 1.0), (0.180, 0.190, 0.210, 1.0)),
             "backdrop": (0.030, 0.034, 0.042, 1.0), "text": None},
    # As "dark", but a petrol-blue shirt keeps the green trunk mark legible.
    "slate": {"skin": (0.400, 0.305, 0.250, 1.0),
              "top": ((0.050, 0.120, 0.200, 1.0), (0.032, 0.080, 0.135, 1.0)),
              "shorts": ((0.260, 0.270, 0.290, 1.0), (0.180, 0.190, 0.210, 1.0)),
              "backdrop": (0.030, 0.034, 0.042, 1.0), "text": None},
    "light": {"skin": (0.340, 0.240, 0.185, 1.0),
              "top": ((0.035, 0.140, 0.120, 1.0), (0.020, 0.090, 0.080, 1.0)),
              "shorts": ((0.030, 0.034, 0.042, 1.0), (0.020, 0.022, 0.028, 1.0)),
              "backdrop": (0.500, 0.490, 0.470, 1.0), "text": (0.040, 0.045, 0.045, 1.0)},
}
LIGHTS = {  # name: (energy W, square size m, location); all aim at the chest
    "Key": (320.0, 2.2, (-1.9, -3.3, 2.7)),
    "Fill": (110.0, 4.4, (2.4, -3.0, 1.7)),
    "Top": (80.0, 2.4, (0.0, -0.8, 3.7)),
}


def mesh_digest(obj):
    points = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", points)
    return hashlib.sha256(points.tobytes()).hexdigest()


def read_mhclo(path: Path):
    """Parse the vertex bindings and scale references of a MakeHuman .mhclo file."""
    bindings, scales, obj_file, reading = [], {}, None, False
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        words = line.split()
        if not words or words[0].startswith("#"):
            reading = False if not words else reading
            continue
        if reading:
            if not words[0].lstrip("-").isdigit():
                reading = False
            elif len(words) == 1:
                bindings.append(((int(words[0]),) * 3, (1., 0., 0.), (0., 0., 0.)))
                continue
            else:
                numbers = [float(w) for w in words[:9]]
                bindings.append((tuple(int(n) for n in numbers[:3]), tuple(numbers[3:6]), tuple(numbers[6:9])))
                continue
        if words[0] == "verts":
            reading = True
        elif words[0] in ("x_scale", "y_scale", "z_scale"):
            scales[words[0]] = (int(words[1]), int(words[2]), float(words[3]))
        elif words[0] == "obj_file":
            obj_file = words[1]
        elif words[0] == "delete_verts":
            raise RuntimeError("Hair that deletes body vertices is not supported")
    if obj_file is None or len(scales) != 3 or not bindings:
        raise RuntimeError(f"Incomplete MakeHuman binding file {path}")
    return bindings, scales, obj_file


def read_obj(path: Path):
    """Vertices in file order, texture coordinates and face corner indices."""
    verts, uvs, faces = [], [], []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        words = line.split()
        if not words:
            continue
        if words[0] == "v":
            verts.append(tuple(float(w) for w in words[1:4]))
        elif words[0] == "vt":
            uvs.append((float(words[1]), float(words[2])))
        elif words[0] == "f":
            faces.append([(int(c.split("/")[0]) - 1, int(c.split("/")[1]) - 1 if "/" in c and c.split("/")[1] else None)
                          for c in words[1:]])
    return verts, uvs, faces


def fit_hair(body, rig, hair_dir: Path, name: str):
    bindings, scales, obj_file = read_mhclo(hair_dir / f"{name}.mhclo")
    verts, uvs, faces = read_obj(hair_dir / obj_file)
    if len(verts) != len(bindings):
        raise RuntimeError("Hair mesh and bindings disagree on vertex count")
    human = np.array([v.co[:] for v in body.data.vertices])
    (xa, xb, xd), (ya, yb, yd), (za, zb, zd) = scales["x_scale"], scales["y_scale"], scales["z_scale"]
    # MakeHuman is Y-up: its x/y/z scales measure Blender x, z and y.
    size = np.array([abs(human[xa, 0] - human[xb, 0]) / xd,
                     abs(human[za, 1] - human[zb, 1]) / zd,
                     abs(human[ya, 2] - human[yb, 2]) / yd])
    fitted = []
    for (i, j, k), (wi, wj, wk), (d0, d1, d2) in bindings:
        offset = np.array([d0, -d2, d1]) * size
        fitted.append(tuple(wi*human[i] + wj*human[j] + wk*human[k] + offset))
    mesh = bpy.data.meshes.new("Figure_Hair")
    mesh.from_pydata(fitted, [], [[c[0] for c in face] for face in faces])
    layer = mesh.uv_layers.new(name="UVMap")
    corner = 0
    for face in faces:
        for _, uv in face:
            layer.data[corner].uv = uvs[uv] if uv is not None else (0., 0.)
            corner += 1
    mesh.validate()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    hair = bpy.data.objects.new("Figure_Hair", mesh)
    bpy.context.scene.collection.objects.link(hair)
    hair.parent = rig
    group = hair.vertex_groups.new(name="head")
    group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    modifier = hair.modifiers.new("Follow the head", "ARMATURE")
    modifier.object = rig
    hair.data.materials.append(hair_material(hair_dir, name))
    return hair, {"asset": name, "vertices": len(mesh.vertices), "faces": len(mesh.polygons),
                  "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                            for p in sorted(hair_dir.iterdir()) if p.suffix in (".mhclo", ".obj", ".png", ".mhmat")}}


def hair_material(hair_dir: Path, name: str):
    material = bpy.data.materials.new("Figure hair")
    material.use_nodes = True
    material.surface_render_method = "DITHERED"
    material.use_transparent_shadow = True
    material.use_backface_culling = False
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    image = bpy.data.images.load(str(hair_dir / f"{name}_diffuse.png"))
    image.pack()
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    tint = nodes.new("ShaderNodeMix")
    tint.data_type, tint.blend_type = "RGBA", "MULTIPLY"
    tint.inputs["Factor"].default_value = 1.0
    tint.inputs["B"].default_value = HAIR_TINT
    links.new(texture.outputs["Color"], tint.inputs["A"])
    links.new(tint.outputs["Result"], shader.inputs["Base Color"])
    links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    normal_path = hair_dir / f"{name}_normal.png"
    if normal_path.exists():
        normal_image = bpy.data.images.load(str(normal_path))
        normal_image.colorspace_settings.name = "Non-Color"
        normal_image.pack()
        normal_texture = nodes.new("ShaderNodeTexImage")
        normal_texture.image = normal_image
        normal_map = nodes.new("ShaderNodeNormalMap")
        links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    shader.inputs["Roughness"].default_value = .55
    shader.inputs["Specular IOR Level"].default_value = .25
    return material


def soften_skin(body, skin_rgba):
    material = body.data.materials[0]
    shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    mix = shader.inputs["Base Color"].links[0].from_node
    colour = mix.inputs["Color1"].links[0].from_node
    if colour.type != "RGB":
        raise RuntimeError("Unexpected skin colour graph")
    colour.outputs[0].default_value = skin_rgba
    weight, radius, scale = SKIN_SUBSURFACE
    shader.inputs["Subsurface Weight"].default_value = weight
    shader.inputs["Subsurface Radius"].default_value = radius
    shader.inputs["Subsurface Scale"].default_value = scale
    shader.inputs["Roughness"].default_value = SKIN_ROUGHNESS
    shader.inputs["Specular IOR Level"].default_value = SKIN_SPECULAR


def relight(scene, body):
    scene.frame_set(scene.frame_start)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = body.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    heights = [v.co.z for v in mesh.vertices]
    evaluated.to_mesh_clear()
    aim = Vector((0.0, 0.0, min(heights) + (max(heights) - min(heights)) * 0.72))
    for name, (energy, size, location) in LIGHTS.items():
        light = scene.objects[name]
        light.data.energy, light.data.size, light.data.shape = energy, size, "SQUARE"
        light.data.use_shadow_jitter = True
        light.location = location
        light.rotation_euler = (aim - Vector(location)).to_track_quat("-Z", "Y").to_euler()


def recolour_garments(scene, palette):
    """Set each garment's fabric and trim colours; its landmark-mark mix stays as built."""
    for name, key in [("Figure_Top", "top"), ("Figure_Shorts", "shorts")]:
        material = scene.objects[name].data.materials[0]
        shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        marks = shader.inputs["Base Color"].links[0].from_node
        fabric = marks.inputs["Color1"].links[0].from_node
        if marks.type != "MIX_RGB" or fabric.type != "MIX_RGB":
            raise RuntimeError(f"Unexpected colour graph on {name}")
        fabric.inputs["Color1"].default_value, fabric.inputs["Color2"].default_value = palette[key]


def label_colour(rgba):
    for material in bpy.data.materials:
        if material.name.startswith("Figure preview text") and material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type == "EMISSION":
                    node.inputs["Color"].default_value = rgba
                    node.inputs["Strength"].default_value = 1.0


def studio_backdrop(scene, backdrop_rgba):
    """A seamless sweep: floor curving into a back wall, so no horizon line crosses the figure."""
    floor = scene.objects.get("Floor")
    foot = floor.location.z if floor else 0.0
    if floor:
        bpy.data.objects.remove(floor, do_unlink=True)
    back, radius, top, half = 3.2, 1.6, 4.5, 6.0
    profile = [(y, foot) for y in np.linspace(-8.0, back - radius, 6)]
    for a in np.linspace(0, math.pi / 2, 13)[1:]:
        profile.append((back - radius + radius * math.sin(a), foot + radius - radius * math.cos(a)))
    profile += [(back, z) for z in np.linspace(foot + radius, top, 5)[1:]]
    verts = [(x, y, z) for (y, z) in profile for x in (-half, half)]
    faces = [(2*i, 2*i + 1, 2*i + 3, 2*i + 2) for i in range(len(profile) - 1)]
    mesh = bpy.data.meshes.new("Studio backdrop")
    mesh.from_pydata(verts, [], faces)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    material = bpy.data.materials.new("Studio backdrop")
    material.use_nodes = True
    shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = backdrop_rgba
    shader.inputs["Roughness"].default_value = .9
    shader.inputs["Specular IOR Level"].default_value = .1
    mesh.materials.append(material)
    backdrop = bpy.data.objects.new("Floor", mesh)
    scene.collection.objects.link(backdrop)
    background = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
    background.inputs["Color"].default_value = backdrop_rgba
    background.inputs["Strength"].default_value = .6
    return {"back_wall_y_m": back, "sweep_radius_m": radius, "colour": list(backdrop_rgba)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--hair-dir", required=True, type=Path)
    parser.add_argument("--hair", default="short02")
    parser.add_argument("--palette", choices=list(PALETTES), default="slate",
                        help="slate is the accepted look (user choice 2026-09-25); the others are kept for comparison")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    palette = PALETTES[args.palette]
    source = args.source.resolve()
    if args.output.exists() or args.output.resolve() == source:
        parser.error("Use a fresh output; existing scenes are never overwritten")
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    body, rig = scene.objects["Figure_Body"], scene.objects["Figure_Rig"]
    if "Figure_Hair" in scene.objects:
        raise RuntimeError("The source already has hair")
    before = {n: mesh_digest(scene.objects[n]) for n in MESH_NAMES}
    hair, hair_record = fit_hair(body, rig, args.hair_dir, args.hair)
    soften_skin(body, palette["skin"])
    recolour_garments(scene, palette)
    relight(scene, body)
    backdrop = studio_backdrop(scene, palette["backdrop"])
    if palette["text"] is not None:
        label_colour(palette["text"])
    # The draft builder labels its scenes with this material, which nothing in
    # the figure scene uses; keep it through the save.
    for material in bpy.data.materials:
        if material.name.startswith("Figure preview text"):
            material.use_fake_user = True
    if any(mesh_digest(scene.objects[n]) != before[n] for n in MESH_NAMES):
        raise RuntimeError("Body or garment coordinates changed")
    weight, radius, scale = SKIN_SUBSURFACE
    record = {"revision": LOOK_REVISION, "source_file": source.name, "source_sha256": source_hash,
              "hair": hair_record, "palette": args.palette,
              "colours": {k: (list(map(list, v)) if k in ("top", "shorts") else list(v) if v else None)
                          for k, v in palette.items()},
              "skin_subsurface": {"weight": weight, "radius": list(radius), "scale_m": scale},
              "skin_roughness": SKIN_ROUGHNESS, "skin_specular": SKIN_SPECULAR,
              "lights": {k: {"energy_w": e, "size_m": s, "location": list(l)} for k, (e, s, l) in LIGHTS.items()},
              "backdrop": backdrop, "mesh_vertex_sha256": before,
              "scope": "Presentation only; no clinical or anatomical claim."}
    scene["figure_look"] = json.dumps(record)
    scene.frame_set(scene.frame_start)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output.resolve()))
    args.output.with_suffix(".look.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError("Source changed during the upgrade")
    print("LOOK_SAVED=" + json.dumps({"output": str(args.output), "hair_vertices": hair_record["vertices"]}), flush=True)


if __name__ == "__main__":
    main()
