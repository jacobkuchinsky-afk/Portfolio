# Stage 1: import the FlightGear MD-11F AC3D model into a clean scene.
# Usage: blender -b --factory-startup -P s1_import_ac.py -- <model.ac> <out.blend>
# Axis convention: AC3D is y-up with the nose toward -x. Blender result: nose +X, left wing +Y, up +Z.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

ac_path, out_path = sys.argv[sys.argv.index('--') + 1:][:2]
tex_dir = os.path.abspath(os.path.dirname(ac_path))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0

AC_TO_BL = Matrix(((-1, 0, 0), (0, 0, 1), (0, 1, 0)))  # (ax, ay, az) -> (-ax, az, ay)

lines = open(ac_path, encoding='latin-1').read().split('\n')
pos = 0
def nxt():
    global pos
    while pos < len(lines) and not lines[pos].strip():
        pos += 1
    ln = lines[pos]; pos += 1
    return ln

ac_mats = []
assert nxt().startswith('AC3D')
mat_cache, img_cache = {}, {}

def get_mat(idx, tex):
    key = (idx, tex)
    if key in mat_cache:
        return mat_cache[key]
    name, rgb = ac_mats[idx] if idx < len(ac_mats) else ('none', (0.8, 0.8, 0.8))
    m = bpy.data.materials.new(f"src|{tex or '-'}|{idx}|{name}")
    m.diffuse_color = (*rgb, 1)
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    if tex:
        if tex not in img_cache:
            p = os.path.join(tex_dir, tex)
            img_cache[tex] = bpy.data.images.load(p) if os.path.exists(p) else None
        if img_cache[tex]:
            n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = img_cache[tex]
            m.node_tree.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
    m['ac_tex'] = tex or ''
    m['ac_idx'] = idx
    mat_cache[key] = m
    return m

skipped = {'lines': 0, 'degenerate': 0, 'dupe': 0}

def read_object(parent_mat):
    hdr = nxt().split()
    assert hdr[0] == 'OBJECT', hdr
    o = {'name': '', 'tex': '', 'rot': Matrix.Identity(3), 'loc': Vector((0, 0, 0)),
         'rep': (1, 1), 'off': (0, 0), 'crease': 61.0, 'verts': [], 'surfs': []}
    while True:
        ln = nxt(); t = ln.split()
        k = t[0]
        if k == 'name': o['name'] = ln.split('"')[1] if '"' in ln else t[1]
        elif k == 'data':
            n = int(t[1]); got = 0
            while got < n:
                s = lines[pos]; globals()['pos'] += 1; got += len(s) + 1
        elif k == 'texture': o['tex'] = ln.split('"')[1]
        elif k == 'texrep': o['rep'] = (float(t[1]), float(t[2]))
        elif k == 'texoff': o['off'] = (float(t[1]), float(t[2]))
        elif k == 'rot':
            v = list(map(float, t[1:10]))
            o['rot'] = Matrix((v[0:3], v[3:6], v[6:9])).transposed()
        elif k == 'loc': o['loc'] = Vector(map(float, t[1:4]))
        elif k == 'crease': o['crease'] = float(t[1])
        elif k == 'url': pass
        elif k == 'numvert':
            for _ in range(int(t[1])):
                o['verts'].append(Vector(map(float, nxt().split()[:3])))
        elif k == 'numsurf':
            for _ in range(int(t[1])):
                flags = int(nxt().split()[1], 0)
                mt = nxt().split(); mat = int(mt[1]) if mt[0] == 'mat' else 0
                if mt[0] != 'mat':
                    globals()['pos'] -= 1
                nref = int(nxt().split()[1])
                refs = []
                for _ in range(nref):
                    r = nxt().split()
                    refs.append((int(r[0]), float(r[1]) if len(r) > 1 else 0.0, float(r[2]) if len(r) > 2 else 0.0))
                o['surfs'].append((flags, mat, refs))
        elif k == 'kids':
            world = parent_mat @ Matrix.Translation(o['loc']) @ o['rot'].to_4x4()
            if o['verts']:
                build(o, world)
            for _ in range(int(t[1])):
                read_object(world)
            return

def build(o, world):
    bm = bmesh.new()
    conv = AC_TO_BL.to_4x4() @ world
    bv = [bm.verts.new(conv @ v) for v in o['verts']]
    uv = bm.loops.layers.uv.new('UVMap')
    mats = []
    for flags, mi, refs in o['surfs']:
        if flags & 0xF:
            skipped['lines'] += 1; continue
        seen, clean = set(), []
        for r in refs:
            if r[0] not in seen:
                seen.add(r[0]); clean.append(r)
        if len(clean) < 3:
            skipped['degenerate'] += 1; continue
        try:
            f = bm.faces.new([bv[r[0]] for r in clean])
        except ValueError:
            skipped['dupe'] += 1; continue
        m = get_mat(mi, o['tex'])
        if m not in mats:
            mats.append(m)
        f.material_index = mats.index(m)
        f.smooth = bool(flags & 0x10)
        for loop, r in zip(f.loops, clean):
            loop[uv].uv = (r[1] * o['rep'][0] + o['off'][0], r[2] * o['rep'][1] + o['off'][1])
    if not bm.faces:
        bm.free(); return
    me = bpy.data.meshes.new(o['name'])
    bm.to_mesh(me); bm.free()
    for m in mats:
        me.materials.append(m)
    if any(p.use_smooth for p in me.polygons):
        me.set_sharp_from_angle(angle=math.radians(o['crease']))
    ob = bpy.data.objects.new(o['name'], me)
    ob['ac_tex'] = o['tex']
    scene.collection.objects.link(ob)

# materials precede the world object
while True:
    ln = lines[pos].strip()
    if ln.startswith('MATERIAL'):
        name = ln.split('"')[1]
        t = ln.split('"')[2].split()
        rgb = tuple(map(float, t[t.index('rgb') + 1:t.index('rgb') + 4]))
        ac_mats.append((name, rgb)); pos += 1
    elif not ln:
        pos += 1
    else:
        break
read_object(Matrix.Identity(4))

mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
tris = 0
for ob in scene.objects:
    for v in ob.data.vertices:
        mn = Vector(map(min, mn, v.co)); mx = Vector(map(max, mx, v.co))
    tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)
print('OBJECTS', len(scene.objects), 'TRIS', tris, 'SKIPPED', skipped)
print('BBOX min', tuple(round(c, 3) for c in mn), 'max', tuple(round(c, 3) for c in mx), 'size', tuple(round(c, 3) for c in (mx - mn)))
bpy.ops.wm.save_as_mainfile(filepath=out_path)
