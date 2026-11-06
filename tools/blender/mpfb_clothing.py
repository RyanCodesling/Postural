"""Author fitted athletic garments around the saved MPFB body.

These are separate, weighted surfaces with open neck/arm/leg holes, fabric
thickness, bound edges and a relaxed shorts silhouette. The body and the rig's
animation are never reshaped. No cloth simulation or downloaded asset is used.
"""
import heapq
import math

import bpy
from mathutils import Vector


def clipped_surface(source, groups, fields):
    """Clip faces at interpolated field zeros, sharing new edge vertices.

    Interpolated weights keep each cut point attached to the original rig;
    clipping within faces avoids the stair-step edge of face-only selection.
    """
    points = [v.co.copy() for v in source.vertices]
    weights = [{g.group: g.weight for g in v.groups if g.group in groups}
               for v in source.vertices]
    faces = [list(p.vertices) for p in source.polygons]
    for field in fields:
        values = [field(p, w) for p, w in zip(points, weights)]
        crossings, next_faces = {}, []
        for face in faces:
            result = []
            for a, b in zip(face, face[1:] + face[:1]):
                va, vb = values[a], values[b]
                if va >= 0:
                    result.append(a)
                if (va >= 0) != (vb >= 0):
                    key = tuple(sorted((a, b)))
                    if key not in crossings:
                        t = va / (va - vb)
                        crossings[key] = len(points)
                        points.append(points[a].lerp(points[b], t))
                        weights.append({g: weights[a].get(g, 0) * (1-t) + weights[b].get(g, 0) * t
                                        for g in weights[a].keys() | weights[b].keys()})
                    result.append(crossings[key])
            if len(set(result)) >= 3:
                next_faces.append(result)
        faces = next_faces
    used = sorted({i for face in faces for i in face})
    remap = {old: new for new, old in enumerate(used)}
    return ([points[i] for i in used], [weights[i] for i in used],
            [[remap[i] for i in face] for face in faces])


def cloth_material(name, colour, trim_colour, guide_material):
    """Retain the established guide shader, replacing the painted-clothes mix."""
    mat = guide_material.copy()
    mat.name = name
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    colour_mix = next(n for n in nt.nodes if n.type == 'MIX_RGB' and n.location.x == 2000)
    for link in list(colour_mix.inputs[1].links):
        nt.links.remove(link)
    colour_mix.inputs[1].default_value = colour
    bsdf.inputs['Roughness'].default_value = .84
    bsdf.inputs['Specular IOR Level'].default_value = .24
    bsdf.inputs['Sheen Weight'].default_value = .22
    bsdf.inputs['Sheen Roughness'].default_value = .75
    rest = nt.nodes.new('ShaderNodeAttribute')
    rest.attribute_name = 'fabric_co'
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 850
    noise.inputs['Detail'].default_value = 2
    noise.inputs['Roughness'].default_value = .65
    nt.links.new(rest.outputs['Vector'], noise.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .22
    bump.inputs['Distance'].default_value = .00032
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    edge = nt.nodes.new('ShaderNodeAttribute')
    edge.attribute_name = 'edge_distance'
    band = nt.nodes.new('ShaderNodeMath')
    band.operation = 'LESS_THAN'
    band.inputs[1].default_value = .007
    nt.links.new(edge.outputs['Fac'], band.inputs[0])
    mix = nt.nodes.new('ShaderNodeMixRGB')
    mix.inputs[1].default_value = colour
    mix.inputs[2].default_value = trim_colour
    nt.links.new(band.outputs[0], mix.inputs[0])
    nt.links.new(mix.outputs[0], colour_mix.inputs[1])
    # A fine stitch just inside the binding, rather than thick decorative piping.
    subtract = nt.nodes.new('ShaderNodeMath')
    subtract.operation = 'SUBTRACT'
    subtract.inputs[1].default_value = .0045
    nt.links.new(edge.outputs['Fac'], subtract.inputs[0])
    absolute = nt.nodes.new('ShaderNodeMath')
    absolute.operation = 'ABSOLUTE'
    nt.links.new(subtract.outputs[0], absolute.inputs[0])
    stitch = nt.nodes.new('ShaderNodeMath')
    stitch.operation = 'LESS_THAN'
    stitch.inputs[1].default_value = .00045
    nt.links.new(absolute.outputs[0], stitch.inputs[0])
    sewn = nt.nodes.new('ShaderNodeBump')
    sewn.inputs['Strength'].default_value = .3
    sewn.inputs['Distance'].default_value = .00065
    nt.links.new(stitch.outputs[0], sewn.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], sewn.inputs['Normal'])
    nt.links.new(sewn.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def make_garment(body, rig, source, name, fields, material, kind):
    bones = {g.index: g.name for g in body.vertex_groups if g.name in rig.data.bones}
    points, weights, faces = clipped_surface(source, bones, fields)
    if not faces:
        raise RuntimeError(f'{name}: empty clothing surface')
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(points, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = rig
    obj.matrix_world = body.matrix_world.copy()
    for g in body.vertex_groups:
        obj.vertex_groups.new(name=g.name)
    for i, ws in enumerate(weights):
        total = sum(ws.values())
        if total < 1e-6:
            raise RuntimeError(f'{name}: unweighted garment vertex')
        for g, w in ws.items():
            obj.vertex_groups[g].add([i], w / total, 'REPLACE')

    adj = [[] for _ in points]
    edge_count = {}
    for face in faces:
        for a, b in zip(face, face[1:] + face[:1]):
            key = tuple(sorted((a, b)))
            edge_count[key] = edge_count.get(key, 0) + 1
    boundary_adj = {}
    for (a, b), count in edge_count.items():
        adj[a].append(b)
        adj[b].append(a)
        if count == 1:
            boundary_adj.setdefault(a, []).append(b)
            boundary_adj.setdefault(b, []).append(a)
    if any(len(ns) != 2 for ns in boundary_adj.values()):
        raise RuntimeError(f'{name}: branching garment opening')
    # Relax the cut loops and muscle contours before adding garment ease.
    # The final collision modifier restores clearance, without hugging points
    # that are already outside the body.
    for _ in range(18 if kind == 'top' else 8):
        relaxed = [p.copy() for p in points]
        for i, ns in enumerate(adj):
            neighbours = boundary_adj.get(i, ns)
            mean = sum((points[j] for j in neighbours), Vector()) / len(neighbours)
            relaxed[i] = points[i].lerp(mean, .32 if i in boundary_adj else .40)
        points = relaxed
    for i, p in enumerate(points):
        mesh.vertices[i].co = p
    mesh.update()
    normals = [v.normal.copy() for v in mesh.vertices]
    for i, (p, normal) in enumerate(zip(points, normals)):
        if kind == 'top':
            # Extra ease through the waist; smaller clearance on the straps.
            ease = .004 + .014 * max(0, min(1, (1.36-p.z)/.12))
            p += normal * ease
            # Quiet folds close to the hem, tapering out before the chest guide.
            fold = .0015 * math.sin(p.x*84 + p.z*17) * math.exp(-((p.z-.97)/.055)**2)
            p.y += math.copysign(fold, p.y)
        else:
            p += normal * .011
            lower = max(0, min(1, (.89-p.z)/.21))
            centre = Vector((math.copysign(.115, p.x), -.007, p.z))
            radial = Vector((p.x-centre.x, p.y-centre.y, 0))
            if radial.length > 1e-6:
                p += radial.normalized() * (.018 * lower)
            p.z -= .014 * math.exp(-(p.x/.065)**2) * math.exp(-((p.z-.79)/.055)**2)
            p.y += math.copysign(.0012 * math.sin(p.x*95 + p.z*27) * lower, p.y)
        mesh.vertices[i].co = p
    mesh.update()

    # Geodesic distance gives continuous sewn bindings around every opening.
    distance = [math.inf] * len(points)
    heap = []
    for i in boundary_adj:
        distance[i] = 0
        heapq.heappush(heap, (0, i))
    while heap:
        d, i = heapq.heappop(heap)
        if d != distance[i]:
            continue
        for j in adj[i]:
            nd = d + (points[i]-points[j]).length
            if nd < distance[j]:
                distance[j] = nd
                heapq.heappush(heap, (nd, j))
    for attr_name, attr_type in [('rest_co','FLOAT_VECTOR'), ('fabric_co','FLOAT_VECTOR'),
                                 ('armw','FLOAT'), ('edge_distance','FLOAT')]:
        mesh.attributes.new(attr_name, attr_type, 'POINT')
    for i, p in enumerate(points):
        # Rest guide coordinates follow the garment without a geometry-driven
        # shift in the established guide heights.
        mesh.attributes['rest_co'].data[i].vector = p
        mesh.attributes['fabric_co'].data[i].vector = p
        mesh.attributes['armw'].data[i].value = 0
        mesh.attributes['edge_distance'].data[i].value = distance[i]
    mesh.materials.append(material)
    for poly in mesh.polygons:
        poly.use_smooth = True
    sub = obj.modifiers.new('Smooth fabric panels', 'SUBSURF')
    sub.levels = sub.render_levels = 2
    arm = obj.modifiers.new('Follow the existing figure rig', 'ARMATURE')
    arm.object = rig
    clearance = obj.modifiers.new('Keep fabric outside skin', 'SHRINKWRAP')
    clearance.target = body
    clearance.wrap_method = 'NEAREST_SURFACEPOINT'
    clearance.wrap_mode = 'OUTSIDE'
    clearance.offset = .004
    solid = obj.modifiers.new('Fabric thickness and turned hems', 'SOLIDIFY')
    solid.thickness = .0018
    solid.offset = 1
    # Sharp cut corners must not turn a thin hem into a long miter spike.
    solid.use_even_offset = False
    solid.thickness_clamp = 1.0
    final_clearance = obj.modifiers.new('Hem clearance after thickness', 'SHRINKWRAP')
    final_clearance.target = body
    final_clearance.wrap_method = 'NEAREST_SURFACEPOINT'
    final_clearance.wrap_mode = 'OUTSIDE'
    final_clearance.offset = .002
    obj['garment_kind'] = kind
    obj['fabric_thickness_m'] = .0018
    obj['opening_count_expected'] = 4 if kind == 'top' else 3
    obj['construction'] = 'body-derived weighted panels, continuous openings, bound hems; no simulation'
    print(f'GARMENT {name}: {len(points)} vertices, {len(faces)} faces, {len(boundary_adj)} boundary vertices', flush=True)
    return obj


def add_clothing(body, rig):
    saved_pose = rig.data.pose_position
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    source = evaluated.to_mesh()
    try:
        arm_groups = {g.index for g in body.vertex_groups
                      if g.name.startswith(('upperarm_', 'lowerarm_', 'hand_', 'index_', 'middle_', 'pinky_', 'ring_', 'thumb_'))}
        arm_weight = lambda w: sum(v for g, v in w.items() if g in arm_groups)
        pelvis = rig.data.bones['pelvis'].head_local.z
        neck = rig.data.bones['neck_01'].head_local.z
        thigh = rig.data.bones['thigh_l'].head_local.z
        knee = rig.data.bones['calf_l'].head_local.z
        hem = thigh - (thigh-knee)*.49
        # The neck is a cut-out through a continuous shoulder surface. A flat
        # upper-chest height cutoff is what left the former painted top strapless.
        def neck_hole(p, w):
            ry = .100 if p.y < -.005 else .061
            radial = (p.x/.080)**2 + ((p.y+.005)/ry)**2 - 1
            return max(radial, (neck-.16-p.z)*20)
        def underarm(p, w):
            # Leave an actual armhole through the axillary fold. Fabric cannot
            # fit in the almost closed skin-to-skin slit at the resting armpit.
            side = (.120 + .040*((p.y+.010)/.070)**2
                    + .90*max(0,p.z-1.29) + max(0,1.22-p.z))
            return max(side-abs(p.x), 1.20-p.z)
        top_fields = [lambda p,w: p.z-(pelvis+.054),
                      lambda p,w: (neck+.009)-p.z,
                      neck_hole, lambda p,w: .60-arm_weight(w), underarm]
        shorts_fields = [lambda p,w: p.z-hem,
                         lambda p,w: pelvis+.085-p.z,
                         lambda p,w: .05-arm_weight(w)]
        guide = body.data.materials[0]
        top_mat = cloth_material('Figure athletic knit', (.108,.227,.204,1), (.069,.150,.133,1), guide)
        shorts_mat = cloth_material('Figure woven shorts', (.100,.111,.128,1), (.067,.076,.091,1), guide)
        top = make_garment(body,rig,source,'Figure_Top',top_fields,top_mat,'top')
        shorts = make_garment(body,rig,source,'Figure_Shorts',shorts_fields,shorts_mat,'shorts')
        return [top, shorts]
    finally:
        evaluated.to_mesh_clear()
        rig.data.pose_position = saved_pose
        bpy.context.view_layer.update()
