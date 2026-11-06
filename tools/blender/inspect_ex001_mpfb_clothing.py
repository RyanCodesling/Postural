"""Measure saved garment topology and posed clearance independently of its builder.

Every evaluated garment vertex is tested against the skinned body at eleven
poses. This is a sampled vertex clearance check, not continuous collision or
cloth-physics validation. The general figure inspector checks every frame.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils.bvhtree import BVHTree


def topology(mesh):
    adj = [set() for _ in mesh.vertices]
    counts = {}
    for poly in mesh.polygons:
        ids = list(poly.vertices)
        for a,b in zip(ids, ids[1:]+ids[:1]):
            adj[a].add(b)
            adj[b].add(a)
            key = tuple(sorted((a,b)))
            counts[key] = counts.get(key,0)+1
    def components(graph):
        remaining = set(graph)
        count = 0
        while remaining:
            count += 1
            stack = [remaining.pop()]
            while stack:
                for j in graph[stack.pop()]:
                    if j in remaining:
                        remaining.remove(j)
                        stack.append(j)
        return count
    boundary = {}
    for (a,b), n in counts.items():
        if n == 1:
            boundary.setdefault(a,set()).add(b)
            boundary.setdefault(b,set()).add(a)
    return {'components':components(dict(enumerate(adj))),
            'openings':components(boundary),
            'branching_boundary_vertices':sum(len(ns)!=2 for ns in boundary.values()),
            'nonmanifold_edges':sum(n>2 for n in counts.values()),
            'vertices':len(mesh.vertices), 'faces':len(mesh.polygons)}


def signed_clearance(obj, tree):
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = ev.to_mesh()
    minimum, penetrating, worst = math.inf, 0, None
    try:
        for v in mesh.vertices:
            p = ev.matrix_world @ v.co
            if not all(math.isfinite(c) for c in p):
                raise RuntimeError('Non-finite garment geometry')
            near, normal, face, distance = tree.find_nearest(p)
            signed = (p-near).dot(normal)
            if signed < minimum:
                minimum = signed
                worst = {'vertex':v.index,'position':list(p),'body_point':list(near),'body_face':face}
            penetrating += signed < -.0005
        return {'vertices_checked':len(mesh.vertices),
                'minimum_signed_clearance_mm':minimum*1000,
                'vertices_below_minus_half_mm':penetrating, 'worst_sample':worst}
    finally:
        ev.to_mesh_clear()


def main(args):
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
    scene = bpy.context.scene
    garments = [scene.objects[n] for n in ['Figure_Top','Figure_Shorts']]
    failures, tops, samples = [], {}, []
    for obj,expected in zip(garments,[4,3]):
        top = topology(obj.data)
        tops[obj.name] = top
        if top['components']!=1 or top['openings']!=expected or top['branching_boundary_vertices'] or top['nonmanifold_edges']:
            failures.append(f'{obj.name}: disconnected, torn, or incorrect garment openings')
        if not any(m.type=='SOLIDIFY' and m.thickness>0 for m in obj.modifiers):
            failures.append(f'{obj.name}: no garment thickness')
    for frame in [1,24,48,72,96,110,120,144,168,192,210]:
        scene.frame_set(frame)
        dg = bpy.context.evaluated_depsgraph_get()
        body = scene.objects['Figure_Body'].evaluated_get(dg)
        mesh = body.to_mesh()
        try:
            tree = BVHTree.FromPolygons([body.matrix_world@v.co for v in mesh.vertices],
                                       [list(p.vertices) for p in mesh.polygons])
        finally:
            body.to_mesh_clear()
        measures = {obj.name:signed_clearance(obj,tree) for obj in garments}
        for name,result in measures.items():
            if result['vertices_below_minus_half_mm']:
                failures.append(f'{name}: sampled body penetration at frame {frame}')
        samples.append({'frame':frame,'garments':measures})
        print('CLOTHING_FRAME='+json.dumps(samples[-1]),flush=True)
    report = {'source_sha256':source_hash, 'topology':tops, 'poses_checked':len(samples),
              'clearance_method':'all evaluated garment vertices against nearest body face at eleven poses',
              'samples':samples,'failures':failures,'pass':not failures}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    if hashlib.sha256(args.source.read_bytes()).hexdigest()!=source_hash:
        raise RuntimeError('Source changed during inspection')
    print('CLOTHING_INSPECTION='+json.dumps({k:v for k,v in report.items() if k!='samples'}),flush=True)
    if failures:
        raise RuntimeError('Saved clothing inspection failed')


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    main(parser.parse_args(sys.argv[sys.argv.index('--')+1:]))
