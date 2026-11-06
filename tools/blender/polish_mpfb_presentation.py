"""Add restrained eye/skin detail to a copy of an existing MPFB animation.

Keeps all existing mesh coordinates, weights, rig poses, camera framing and
timing. Uses the installed CC0 MakeHuman high-poly eyes and brown eye texture.
Never overwrites a source or an output. See THIRD_PARTY_ASSETS.md.
"""
import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from upgrade_mpfb_figure_look import read_mhclo, read_obj, mesh_digest

REVISION = "mpfb-eye-skin-detail-2026-10-09"


def motion_digest(scene):
    digest = hashlib.sha256()
    rig = scene.objects['Figure_Rig']
    # These animations have baked rig poses, without mesh-driven constraints.
    # Avoid reevaluating the expensive garment shrinkwrap just to read bones.
    modifiers = [(m,m.show_viewport) for o in scene.objects if o.type=='MESH' for m in o.modifiers]
    try:
        for modifier,_ in modifiers: modifier.show_viewport=False
        for frame in range(scene.frame_start, scene.frame_end + 1):
            scene.frame_set(frame)
            for bone in rig.pose.bones:
                digest.update(struct.pack('16f', *(v for row in bone.matrix for v in row)))
    finally:
        for modifier,value in modifiers: modifier.show_viewport=value
        scene.frame_set(scene.frame_start)
    return digest.hexdigest()


def weights_digest(obj):
    digest=hashlib.sha256()
    for group in obj.vertex_groups: digest.update(group.name.encode()+b'\0')
    for vertex in obj.data.vertices:
        for group in vertex.groups: digest.update(struct.pack('IIf',vertex.index,group.group,group.weight))
    return digest.hexdigest()


def add_eyes(scene, eyes_dir):
    body, rig = scene.objects['Figure_Body'], scene.objects['Figure_Rig']
    binding = eyes_dir/'high-poly/high-poly.mhclo'
    bindings, scales, obj_file = read_mhclo(binding)
    verts, uvs, faces = read_obj(binding.parent/obj_file)
    assert len(verts) == len(bindings)
    human = np.array([v.co[:] for v in body.data.vertices])
    xa, xb, xd = scales['x_scale']
    ya, yb, yd = scales['y_scale']
    za, zb, zd = scales['z_scale']
    size = np.array([abs(human[xa, 0]-human[xb, 0])/xd,
                     abs(human[za, 1]-human[zb, 1])/zd,
                     abs(human[ya, 2]-human[yb, 2])/yd])
    points = [tuple(wi*human[i]+wj*human[j]+wk*human[k]+np.array([dx,-dz,dy])*size)
              for (i,j,k),(wi,wj,wk),(dx,dy,dz) in bindings]
    mesh = bpy.data.meshes.new('Figure_Eyes')
    mesh.from_pydata(points, [], [[c[0] for c in f] for f in faces])
    uv = mesh.uv_layers.new(name='UVMap')
    corner = 0
    for f in faces:
        for _, index in f:
            uv.data[corner].uv = uvs[index] if index is not None else (0,0)
            corner += 1
    mesh.validate()
    for polygon in mesh.polygons: polygon.use_smooth = True
    obj = bpy.data.objects.new('Figure_Eyes', mesh)
    scene.collection.objects.link(obj)
    obj.parent = rig
    obj.vertex_groups.new(name='head').add(list(range(len(points))), 1.0, 'REPLACE')
    obj.modifiers.new('Follow head', 'ARMATURE').object = rig
    material = bpy.data.materials.new('Figure warm brown eyes')
    material.use_nodes = True
    shader = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    texture = material.node_tree.nodes.new('ShaderNodeTexImage')
    texture.image = bpy.data.images.load(str(eyes_dir/'materials/brown_eye.png'), check_existing=True)
    texture.image.pack()
    material.node_tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    material.node_tree.links.new(texture.outputs['Alpha'], shader.inputs['Alpha'])
    shader.inputs['Roughness'].default_value = .32
    shader.inputs['Specular IOR Level'].default_value = .22
    mesh.materials.append(material)
    files = [binding, binding.parent/obj_file, eyes_dir/'materials/brown.mhmat', eyes_dir/'materials/brown_eye.png']
    return {'asset':'MakeHuman high-poly eyes / brown', 'license':'CC0', 'vertices':len(points),
            'files':{str(p.relative_to(eyes_dir)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}


def skin_detail(body):
    material = body.data.materials[0]
    shader = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    mix = shader.inputs['Base Color'].links[0].from_node
    base = mix.inputs['Color1'].links[0].from_node
    if base.type != 'RGB': raise RuntimeError('Unexpected skin material graph')
    # Low-amplitude variation baked to rest vertices cannot swim during motion.
    attribute = body.data.color_attributes.new(name='presentation_skin_tint', type='FLOAT_COLOR', domain='POINT')
    tint = (.390, .275, .220)
    for vertex, colour in zip(body.data.vertices, attribute.data):
        x,y,z = vertex.co
        variation = 1 + .018 * math.sin(27*x+13*z) * math.sin(19*y-17*z)
        colour.color = (*(v*variation for v in tint),1)
    node = material.node_tree.nodes.new('ShaderNodeVertexColor')
    node.layer_name = attribute.name
    material.node_tree.links.new(node.outputs['Color'], mix.inputs['Color1'])
    shader.inputs['Subsurface Weight'].default_value = .18
    shader.inputs['Subsurface Scale'].default_value = .006
    return {'tint':tint,'variation_amplitude':.018,'subsurface_weight':.18,'subsurface_scale_m':.006}


def wall_lighting(scene):
    if 'Exercise_Wall' not in scene.objects: return None
    # Keep both authored cameras fixed and retain the wall-contact geometry.
    # A broader key and brighter fill soften the distracting wall shadow.
    scene.objects['Key'].data.size = 3.2
    scene.objects['Fill'].data.energy = 160
    scene.objects['Fill'].data.size = 5.0
    return {'key_size_m':3.2,'fill_energy_w':160,'fill_size_m':5.0,'camera_changed':False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--eyes-dir',type=Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    if args.output.exists() or args.output.resolve()==args.source.resolve(): parser.error('Use a fresh output')
    source_hash=hashlib.sha256(args.source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
    scene=bpy.context.scene
    if 'Figure_Eyes' in scene.objects: raise RuntimeError('Already has eyes; review before upgrading')
    meshes={o.name:mesh_digest(o) for o in scene.objects if o.type=='MESH'}
    weights={o.name:weights_digest(o) for o in scene.objects if o.type=='MESH'}
    motion=motion_digest(scene)
    eyes=add_eyes(scene,args.eyes_dir)
    skin=skin_detail(scene.objects['Figure_Body'])
    lights=wall_lighting(scene)
    assert all(mesh_digest(scene.objects[n])==d for n,d in meshes.items())
    assert all(weights_digest(scene.objects[n])==d for n,d in weights.items())
    assert motion_digest(scene)==motion
    girdle = scene.get('figure_girdle_scale', scene.get('figure_source_girdle_scale'))
    assert girdle is not None and abs(float(girdle)-.475)<1e-7, f'Unexpected source girdle: {girdle}'
    report={'revision':REVISION,'source_file':args.source.name,'source_sha256':source_hash,
            'eyes':eyes,'skin':skin,'wall_lighting':lights,'original_meshes':meshes,'original_weights':weights,
            'motion_sha256':motion,'frames':scene.frame_end,'source_girdle_scale':girdle,
            'scope':'Presentation candidate; source preserved, no clinical claim or automatic promotion.'}
    scene['figure_presentation_detail']=json.dumps(report)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output.resolve()))
    assert hashlib.sha256(args.source.read_bytes()).hexdigest()==source_hash
    report['output_sha256']=hashlib.sha256(args.output.read_bytes()).hexdigest()
    args.output.with_suffix('.presentation.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print('PRESENTATION_COMPLETE='+json.dumps(report))


if __name__=='__main__': main()
