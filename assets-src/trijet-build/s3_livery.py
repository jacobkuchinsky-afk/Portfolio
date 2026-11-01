# Stage 3: yellow/black livery. Classify faces by source part, unwrap three atlases, bake base colour,
# roughness/metal and AO with Cycles, draw black trim lines in UV space, build glTF-ready materials.
# Usage: blender -b stage2.blend -P s3_livery.py -- <out.blend> <texture_dir>
import bpy, bmesh, sys, os, math, re, numpy as np
from mathutils import Vector

out_path, tex_dir = sys.argv[sys.argv.index('--') + 1:][:2]
tex_dir = os.path.abspath(tex_dir); os.makedirs(tex_dir, exist_ok=True)
sc = bpy.context.scene
O = bpy.data.objects
NAMES = list(sc['part_names'])
RES = 2048
SRC_TEX = os.path.abspath(os.path.join(os.path.dirname(bpy.data.filepath), '../md11-source/Models'))

def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

YELLOW, BLACK = srgb('#F4BC1C'), srgb('#0E0F11')
CHEAT_Z = (5.45, 5.80)   # black cheatline band (m above ground)
CHEAT_X = (-21.0, 31.0)  # aft / forward ends, both cut on a forward-leaning slant
CHEAT_SLANT = 0.7

# ---- finishes: (atlas, base colour, roughness, metallic)
F = {
    'paint':   ('Paint', YELLOW, 0.35, 0.0),
    'wing':    ('Wing', srgb('#C9CDD1'), 0.45, 0.0),
    'polished': ('Polished', None, None, None),
    'cheat':   ('Black', None, None, None),
    'glass':   ('Glass', None, None, None),
    'trim':    ('Detail', BLACK, 0.32, 0.0),
    'gear':    ('Detail', srgb('#9EA3A8'), 0.45, 0.6),
    'chrome':  ('Detail', srgb('#E8EAEC'), 0.10, 1.0),
    'rubber':  ('Detail', srgb('#1A1A1B'), 0.90, 0.0),
    'hub':     ('Detail', srgb('#B9BDC1'), 0.32, 1.0),
    'fan':     ('Detail', srgb('#4A4E54'), 0.40, 1.0),
    'edark':   ('Detail', srgb('#2A2C2F'), 0.60, 0.3),
    'exhaust': ('Detail', srgb('#77716B'), 0.45, 1.0),
}
FKEYS = list(F)

RULES = [  # first match wins, matched against the source part name
    (r'^(Intakes|engines\.chrome|slat\.[1-4].*|fuselage\.cone\.00[23])$', 'polished'),
    (r'^(Windshield|ldglight\.(left|right)\.glass|wing\.glass\.(left|right))$', 'glass'),
    (r'^(windshield\.frames|wiper\..*|wing\.antennas\..*|VHF\..*|fuselage\.cone\.001|ldglight\.(left|right)|Cube\.005)$', 'trim'),
    (r'^(front|left|right|central)\.strut\.low$', 'chrome'),
    (r'^tyres.*$', 'tyre'),
    (r'^(front\.strut\.high|.*\.strut\.up|.*\.strut\.low2|.*scissor.*|.*\.arm\d)$', 'gear'),
    (r'^fan_\d.*$', 'fan'),
    (r'^(engine_1_3_nozzlecone|engine_2_nozzlecone)$', 'exhaust'),
    (r'^(engines\.00\d|right\.reverser\.00\d|Cylinder\.001|engines_2_vanedisk|center\.reverser_inner|slat\.00[05]|Cube\.006|fuselage\.002)$', 'edark'),
    (r'^(wing\.[12].*|wing[12]\.grey.*|HorzStab\d|elevator\..*|Aileron.*|flap\..*|sp\.brake\..*|Pylons)$', 'wing'),
    (r'^(fuselage|fuselage\.cone|[lr]door\.\d|cargo.*|engines|(left|right|center)\.reverser|engines_2_duct\.x|rudder.*|winglet\..*|lgdoor\..*|main\.(left|right)\.door|central\.(front|back)\..*|(left|right)\.main\.door|flap\.[35]\.part2|SatCom)$', 'paint'),
]
CHEAT_PARTS = {'fuselage', 'ldoor.1', 'ldoor.2', 'ldoor.3', 'ldoor.4', 'rdoor.1', 'rdoor.2', 'rdoor.3', 'rdoor.4', 'cargo.door'}
# black outlines: (regex, width in metres, edge kind) - 'perim' = boundary + sharp edges, 'boundary' = open edges only
OUTLINES = [
    (r'^([lr]door\.\d|cargo.*|lgdoor\..*|main\.(left|right)\.door|central\.(front|back)\..*|(left|right)\.main\.door)$', 0.05, 'perim'),
    (r'^(Aileron.*|flap\.([1-8]|11|12|000|015)|sp\.brake\..*|elevator\..*|rudder.*)$', 0.045, 'perim'),
    (r'^(engines|(left|right|center)\.reverser|engines_2_duct\.x)$', 0.07, 'boundary'),
]

def finish_of(name):
    for rx, f in RULES:
        if re.match(rx, name): return f
    raise KeyError(name)

meshes = [o for o in O if o.type == 'MESH' and not o.name.startswith('Light_')]

# ---- per-face finish attribute (tyres split into rubber / hub by their texture region)
for ob in meshes:
    me = ob.data
    pid = [0] * len(me.polygons); me.attributes['part_id'].data.foreach_get('value', pid)
    uv = me.uv_layers['UVMap'].data
    fin, cheat = [], []
    for p, i in zip(me.polygons, pid):
        f = finish_of(NAMES[i])
        if f == 'tyre':
            u = sum(uv[l].uv.x for l in p.loop_indices) / p.loop_total
            v = sum(uv[l].uv.y for l in p.loop_indices) / p.loop_total
            f = 'rubber' if (u < 0.29 and v > 0.72) or (u < 0.2 and v > 0.6) else 'hub'
        fin.append(FKEYS.index(f)); cheat.append(1 if NAMES[i] in CHEAT_PARTS else 0)
    me.attributes.new('finish', 'INT', 'FACE').data.foreach_set('value', fin)
    me.attributes.new('cheat', 'INT', 'FACE').data.foreach_set('value', cheat)

# ---- geometric cheatline: cut the fuselage along the stripe edges so it stays sharp at any zoom.
# Original corner normals ride along as an interpolated attribute and are restored as custom normals.
def cut_cheatline(ob):
    me = ob.data
    nrm = me.attributes.new('onrm', 'FLOAT_VECTOR', 'CORNER')
    nrm.data.foreach_set('vector', [c for n in me.corner_normals for c in n.vector])
    bm = bmesh.new(); bm.from_mesh(me)
    pl, fl = bm.faces.layers.int['part_id'], bm.faces.layers.int['finish']
    in_parts = lambda f: NAMES[f[pl]] in CHEAT_PARTS
    k = CHEAT_SLANT; kn = Vector((1, 0, -k)).normalized()
    planes = [(Vector((0, 0, CHEAT_Z[0])), Vector((0, 0, 1))), (Vector((0, 0, CHEAT_Z[1])), Vector((0, 0, 1))),
              (Vector((CHEAT_X[1], 0, CHEAT_Z[0])), kn), (Vector((CHEAT_X[0], 0, CHEAT_Z[0])), kn)]
    for co, no in planes:
        geom = [f for f in bm.faces if in_parts(f)]
        geom = geom + list({e for f in geom for e in f.edges}) + list({v for f in geom for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=1e-5)
    n = 0
    for f in bm.faces:
        if not in_parts(f): continue
        c = f.calc_center_median()
        sl = k * (c.z - CHEAT_Z[0])
        if CHEAT_Z[0] < c.z < CHEAT_Z[1] and CHEAT_X[0] + sl < c.x < CHEAT_X[1] + sl:
            f[fl] = FKEYS.index('cheat'); n += 1
    bm.to_mesh(me); bm.free()
    vals = [0.0] * (len(me.loops) * 3); me.attributes['onrm'].data.foreach_get('vector', vals)
    v = np.array(vals).reshape(-1, 3); v /= np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)
    me.normals_split_custom_set(v.tolist())
    me.attributes.remove(me.attributes['onrm'])
    print('CHEATLINE faces', n)
cut_cheatline(O['Airframe'])

def faces_in(ob, atlas):
    fin = [0] * len(ob.data.polygons); ob.data.attributes['finish'].data.foreach_get('value', fin)
    return [F[FKEYS[f]][0] == atlas for f in fin]

# ---- unwrap each atlas into a shared UVAtlas layer
for ob in meshes:
    if 'UVAtlas' not in ob.data.uv_layers:
        ob.data.uv_layers.new(name='UVAtlas')
    ob.data.uv_layers.active = ob.data.uv_layers['UVAtlas']

def unwrap(atlas):
    obs = [ob for ob in meshes if any(faces_in(ob, atlas))]
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:
        sel = faces_in(ob, atlas)
        ob.data.polygons.foreach_set('select', sel)
        vs = set(v for p, s in zip(ob.data.polygons, sel) if s for v in p.vertices)
        ob.data.vertices.foreach_set('select', [i in vs for i in range(len(ob.data.vertices))])
        ob.data.edges.foreach_set('select', [all(v in vs for v in e.vertices) for e in ob.data.edges])
        ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    sc.tool_settings.mesh_select_mode = (False, False, True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.006, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='AXIS_ALIGNED', margin=0.006)
    bpy.ops.object.mode_set(mode='OBJECT')
    return obs

ATLASES = ['Paint', 'Wing', 'Detail']
atlas_objs = {a: unwrap(a) for a in ATLASES}

# ---- bake materials
def node(nt, t, **kw):
    n = nt.nodes.new(t)
    for k, v in kw.items(): setattr(n, k, v)
    return n

def select_value(nt, fin_out, values, socket_type):
    """Build a node chain that outputs values[k] where finish == k."""
    cur = None
    for k, val in values.items():
        cmp = node(nt, 'ShaderNodeMath', operation='COMPARE'); cmp.inputs[1].default_value = FKEYS.index(k); cmp.inputs[2].default_value = 0.1
        nt.links.new(fin_out, cmp.inputs[0])
        if socket_type == 'RGB':
            mix = node(nt, 'ShaderNodeMix', data_type='RGBA')
            nt.links.new(cmp.outputs[0], mix.inputs['Factor'])
            if cur is None: mix.inputs[6].default_value = (0, 0, 0, 1)
            else: nt.links.new(cur, mix.inputs[6])
            if isinstance(val, tuple): mix.inputs[7].default_value = (*val, 1)
            else: nt.links.new(val, mix.inputs[7])
            cur = mix.outputs[2]
        else:
            mix = node(nt, 'ShaderNodeMix', data_type='FLOAT')
            nt.links.new(cmp.outputs[0], mix.inputs['Factor'])
            if cur is None: mix.inputs[2].default_value = 0
            else: nt.links.new(cur, mix.inputs[2])
            mix.inputs[3].default_value = val
            cur = mix.outputs[0]
    return cur

def bake_material(atlas):
    m = bpy.data.materials.new(f'BAKE_{atlas}'); m.use_nodes = True; nt = m.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    fin = node(nt, 'ShaderNodeAttribute', attribute_name='finish', attribute_type='GEOMETRY').outputs['Fac']
    fs = {k: v for k, v in F.items() if v[0] == atlas}
    colors = {k: v[1] for k, v in fs.items()}
    if atlas == 'Detail':  # gear parts pick up grime/detail from the source gear texture (original UVs)
        uvn = node(nt, 'ShaderNodeUVMap', uv_map='UVMap')
        img = node(nt, 'ShaderNodeTexImage', image=bpy.data.images.load(os.path.join(SRC_TEX, 'landinggear.png'), check_existing=True))
        nt.links.new(uvn.outputs[0], img.inputs[0])
        bw = node(nt, 'ShaderNodeRGBToBW'); nt.links.new(img.outputs['Color'], bw.inputs[0])
        for k in ('gear', 'hub'):
            mul = node(nt, 'ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY'); mul.inputs['Factor'].default_value = 0.45
            mul.inputs[6].default_value = (*F[k][1], 1)
            g = node(nt, 'ShaderNodeMath', operation='MULTIPLY'); g.inputs[1].default_value = 1.15; nt.links.new(bw.outputs[0], g.inputs[0])
            c = node(nt, 'ShaderNodeCombineColor'); [nt.links.new(g.outputs[0], c.inputs[i]) for i in range(3)]
            nt.links.new(c.outputs[0], mul.inputs[7]); colors[k] = mul.outputs[2]
    col = select_value(nt, fin, colors, 'RGB')
    rough = select_value(nt, fin, {k: v[2] for k, v in fs.items()}, 'FLOAT')
    metal = select_value(nt, fin, {k: v[3] for k, v in fs.items()}, 'FLOAT')
    rm = node(nt, 'ShaderNodeCombineColor'); nt.links.new(rough, rm.inputs[1]); nt.links.new(metal, rm.inputs[2])
    em = node(nt, 'ShaderNodeEmission'); nt.links.new(em.outputs[0], nt.nodes['Material Output'].inputs['Surface'])
    tgt = node(nt, 'ShaderNodeTexImage', name='TARGET'); nt.nodes.active = tgt
    return m, em, col, rm.outputs[0], tgt

bake = {a: bake_material(a) for a in ATLASES}
for k in ('Polished', 'Glass', 'Black'):
    m = bpy.data.materials.new(f'BAKE_{k}'); m.use_nodes = True
    t = m.node_tree.nodes.new('ShaderNodeTexImage'); t.name = 'TARGET'; m.node_tree.nodes.active = t
    bake[k] = (m, None, None, None, t)
ALL = ATLASES + ['Polished', 'Glass', 'Black']

for ob in meshes:  # one slot per atlas/constant material, faces indexed by their finish
    me = ob.data; me.materials.clear()
    for a in ALL: me.materials.append(bake[a][0])
    fin = [0] * len(me.polygons); me.attributes['finish'].data.foreach_get('value', fin)
    me.polygons.foreach_set('material_index', [ALL.index(F[FKEYS[f]][0]) for f in fin])

# ---- Cycles bake
sc.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = 'GPU'
except Exception as e:
    print('GPU unavailable, CPU bake:', e)
sc.render.bake.margin = 10
sc.render.bake.margin_type = 'EXTEND'
w = sc.world or bpy.data.worlds.new('World'); sc.world = w
w.light_settings.distance = 2.5
dummy = bpy.data.images.new('dummy', 8, 8)

def new_img(name, color):
    im = bpy.data.images.new(name, RES, RES, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    return im

def run_bake(atlas, kind, img, samples, hide_gear=False):
    for a in ALL:
        bake[a][4].image = img if a == atlas else dummy
    m, em, col, rm, _ = bake[atlas]
    if kind == 'COL': m.node_tree.links.new(col, em.inputs['Color'])
    if kind == 'RM': m.node_tree.links.new(rm, em.inputs['Color'])
    hidden = [o for o in O if hide_gear and o.name.startswith('Gear_')]
    for o in hidden: o.hide_render = True
    sc.cycles.samples = samples
    bpy.ops.object.select_all(action='DESELECT')
    obs = [o for o in atlas_objs[atlas] if not o.hide_render]
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.bake(type='EMIT' if kind != 'AO' else 'AO', uv_layer='UVAtlas', use_clear=True)
    for o in hidden: o.hide_render = False

def px(img): return np.array(img.pixels[:], dtype=np.float32).reshape(RES, RES, 4)

# ---- black trim lines drawn in UV space
def draw_lines(atlas, img):
    mask = np.zeros((RES, RES), dtype=np.float32)
    rules = [(re.compile(rx), wdt, kind) for rx, wdt, kind in OUTLINES]
    nseg = 0
    for ob in atlas_objs[atlas]:
        bm = bmesh.new(); bm.from_mesh(ob.data); bm.transform(ob.matrix_world)
        uvl = bm.loops.layers.uv['UVAtlas']; pl = bm.faces.layers.int['part_id']; fl = bm.faces.layers.int['finish']
        for f in bm.faces:
            if F[FKEYS[f[fl]]][0] != atlas: continue
            name = NAMES[f[pl]]
            rule = next(((w_, k_) for rx, w_, k_ in rules if rx.match(name)), None)
            if rule is None: continue
            wdt, kind = rule
            uva = sum(abs(((f.loops[i][uvl].uv - f.loops[0][uvl].uv).cross(f.loops[i + 1][uvl].uv - f.loops[0][uvl].uv))) / 2
                      for i in range(1, len(f.loops) - 1))
            if f.calc_area() < 1e-8 or uva < 1e-12: continue
            ppm = math.sqrt(uva * RES * RES / f.calc_area())
            for loop in f.loops:
                e = loop.edge
                same = [g for g in e.link_faces if g is not f and NAMES[g[pl]] == name]
                is_b = not same
                sharp = bool(same) and f.normal.angle(same[0].normal, 0) > math.radians(50)
                if not (is_b or (kind == 'perim' and sharp)): continue
                r = max(0.9, wdt * ppm * (1.0 if is_b else 0.5))
                a = loop[uvl].uv * RES - Vector((0.5, 0.5)); b = loop.link_loop_next[uvl].uv * RES - Vector((0.5, 0.5))
                x0, x1 = int(max(0, min(a.x, b.x) - r - 2)), int(min(RES - 1, max(a.x, b.x) + r + 2))
                y0, y1 = int(max(0, min(a.y, b.y) - r - 2)), int(min(RES - 1, max(a.y, b.y) + r + 2))
                if x1 < x0 or y1 < y0: continue
                X, Y = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
                d = b - a; L2 = max(d.length_squared, 1e-9)
                t = np.clip(((X - a.x) * d.x + (Y - a.y) * d.y) / L2, 0, 1)
                dist = np.hypot(X - (a.x + t * d.x), Y - (a.y + t * d.y))
                mask[y0:y1 + 1, x0:x1 + 1] = np.maximum(mask[y0:y1 + 1, x0:x1 + 1], np.clip(r + 0.5 - dist, 0, 1))
                nseg += 1
        bm.free()
    p = px(img)
    blk = np.array([c ** (1 / 2.2) for c in BLACK], dtype=np.float32)
    p[..., :3] = p[..., :3] * (1 - mask[..., None]) + blk * mask[..., None]
    img.pixels.foreach_set(p.ravel())
    print(f'LINES {atlas}: {nseg} segments')

textures = {}
for atlas in ATLASES:
    bc = new_img(f'T_{atlas}_BaseColor', True); run_bake(atlas, 'COL', bc, 32)
    draw_lines(atlas, bc)
    rmi = new_img(f'T_{atlas}_RM', False); run_bake(atlas, 'RM', rmi, 1)
    ao = new_img(f'T_{atlas}_AO', False); run_bake(atlas, 'AO', ao, 64, hide_gear=(atlas != 'Detail'))
    orm = new_img(f'T_{atlas}_ORM', False)
    a, r = px(ao), px(rmi)
    o = np.ones_like(a); o[..., 0] = 0.25 + 0.75 * a[..., 0]; o[..., 1] = r[..., 1]; o[..., 2] = r[..., 2]
    orm.pixels.foreach_set(o.ravel())
    for im in (bc, orm):
        im.filepath_raw = os.path.join(tex_dir, im.name + '.png'); im.file_format = 'PNG'; im.save()
        im.filepath = im.filepath_raw
    for im in (rmi, ao): bpy.data.images.remove(im)
    textures[atlas] = (bc, orm)
    print('BAKED', atlas)

# ---- final materials
def gltf_output_group():
    ng = bpy.data.node_groups.get('glTF Material Output')
    if ng is None:
        ng = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        ng.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        ng.nodes.new('NodeGroupInput')
    return ng

def final_textured(atlas, coat=0.0):
    bc, orm = textures[atlas]
    m = bpy.data.materials.new(f'M_{atlas}'); m.use_nodes = True; nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    uvn = node(nt, 'ShaderNodeUVMap', uv_map='UVAtlas')
    t1 = node(nt, 'ShaderNodeTexImage', image=bc); t2 = node(nt, 'ShaderNodeTexImage', image=orm)
    for t in (t1, t2): nt.links.new(uvn.outputs[0], t.inputs[0])
    nt.links.new(t1.outputs['Color'], b.inputs['Base Color'])
    sep = node(nt, 'ShaderNodeSeparateColor'); nt.links.new(t2.outputs['Color'], sep.inputs[0])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], b.inputs['Metallic'])
    g = node(nt, 'ShaderNodeGroup'); g.node_tree = gltf_output_group(); nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    if coat:
        b.inputs['Coat Weight'].default_value = coat; b.inputs['Coat Roughness'].default_value = 0.08
    return m

def final_const(name, rgb, rough, metal):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    return m

final = {'Paint': final_textured('Paint', coat=0.3), 'Wing': final_textured('Wing'), 'Detail': final_textured('Detail'),
         'Polished': final_const('M_Polished', srgb('#E4E7EA'), 0.22, 1.0),
         'Glass': final_const('M_Glass', srgb('#07090C'), 0.04, 0.0),
         'Black': final_const('M_PaintBlack', BLACK, 0.4, 0.0)}
final['Black'].node_tree.nodes['Principled BSDF'].inputs['Coat Weight'].default_value = 0.15
final['Black'].node_tree.nodes['Principled BSDF'].inputs['Coat Roughness'].default_value = 0.08
for ob in meshes:
    me = ob.data
    used = sorted(set(p.material_index for p in me.polygons))
    remap = {old: i for i, old in enumerate(used)}
    idx = [remap[p.material_index] for p in me.polygons]
    me.materials.clear()
    for old in used: me.materials.append(final[ALL[old]])
    me.polygons.foreach_set('material_index', idx)
    for n in ('UVMap',):
        if n in me.uv_layers: me.uv_layers.remove(me.uv_layers[n])
for o in O:
    if o.type == 'MESH' and o.name.startswith('Light_') and 'UVMap' in o.data.uv_layers:
        o.data.uv_layers.remove(o.data.uv_layers['UVMap'])
for m in [m for m in bpy.data.materials if m.name.startswith(('BAKE_', 'src|', 'dbg'))]:
    bpy.data.materials.remove(m)
for im in [im for im in bpy.data.images if im.users == 0 or im.name == 'dummy']:
    bpy.data.images.remove(im)
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
bpy.ops.wm.save_as_mainfile(filepath=out_path)
print('MATERIALS', sorted(m.name for m in bpy.data.materials))
