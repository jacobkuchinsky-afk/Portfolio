# Summarise a .glb: nodes (name, parent, tris, translation, extras), animations, materials, images.
import json, struct, sys, os
p = sys.argv[1]
d = open(p, 'rb').read()
jl = struct.unpack('<I', d[12:16])[0]; g = json.loads(d[20:20 + jl])
parent = {c: i for i, n in enumerate(g['nodes']) for c in n.get('children', [])}
def tris(mi):
    t = 0
    for pr in g['meshes'][mi]['primitives']:
        acc = g['accessors'][pr['indices']] if 'indices' in pr else g['accessors'][pr['attributes']['POSITION']]
        t += acc['count'] // 3
    return t
total = 0
for i, n in enumerate(g['nodes']):
    t = tris(n['mesh']) if 'mesh' in n else 0; total += t
    mats = sorted({g['materials'][pr['material']]['name'] for pr in g['meshes'][n['mesh']]['primitives']}) if 'mesh' in n else []
    print(f"NODE {n['name']:28s} tris={t:6d} T={[round(x,3) for x in n.get('translation',[0,0,0])]} R={'id' if 'rotation' not in n else [round(x,4) for x in n['rotation']]} parent={g['nodes'][parent[i]]['name'] if i in parent else '-'} mats={mats} extras={n.get('extras','')}")
print('TOTAL TRIS', total)
for a in g.get('animations', []):
    tgt = sorted({g['nodes'][c['target']['node']]['name'] for c in a['channels']})
    acc = g['accessors'][a['samplers'][0]['input']]
    print('ANIM', a['name'], 'channels', len(a['channels']), 'targets', len(tgt), 'time', acc.get('min'), acc.get('max'))
for m in g['materials']:
    print('MAT', m['name'], {k: v for k, v in m.items() if k not in ('name', 'pbrMetallicRoughness')}, m.get('pbrMetallicRoughness'))
for im in g.get('images', []):
    print('IMG', im.get('name'), im.get('mimeType'), g['bufferViews'][im['bufferView']]['byteLength'] // 1024, 'KB')
print('EXTENSIONS', g.get('extensionsUsed'), 'SIZE_MB', round(os.path.getsize(p) / 1e6, 2), 'CAMERAS', len(g.get('cameras', [])))
