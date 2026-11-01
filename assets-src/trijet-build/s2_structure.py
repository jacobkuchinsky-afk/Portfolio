# Stage 2: ground the model, split/name moving parts, add lights, build the GearRetract action.
# Usage: blender -b stage1.blend -P s2_structure.py -- <out.blend>
# Pivots, axes and timing tables come from FlightGear's MD-11-main.xml (FG frame: x aft, y right, z up).
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix, Quaternion

out_path = sys.argv[sys.argv.index('--') + 1]
O = bpy.data.objects
FPS, F_OLEO, F_END = 24, 12, 132        # 0-12: main oleos extend after liftoff; 12-132: retraction
MAIN_COMP = None                        # solved below so all tyres meet the ground

def fgp(x, y, z):  # FG point -> Blender (before grounding offset)
    return Vector((-x, -y, z))

def interp(table, t):
    table = sorted(table)
    if t <= table[0][0]: return table[0][1]
    if t >= table[-1][0]: return table[-1][1]
    for (a, va), (b, vb) in zip(table, table[1:]):
        if a <= t <= b:
            return va + (vb - va) * (t - a) / (b - a)

def bbox(obs):
    vs = [ob.matrix_world @ v.co for ob in obs for v in ob.data.vertices]
    return Vector(map(min, *vs)), Vector(map(max, *vs))

# ---- part tagging: every face remembers its source object (used by the livery stage)
names = sorted(o.name for o in O if o.type == 'MESH')
for ob in O:
    if ob.type != 'MESH': continue
    a = ob.data.attributes.new('part_id', 'INT', 'FACE')
    a.data.foreach_set('value', [names.index(ob.name)] * len(ob.data.polygons))
bpy.context.scene['part_names'] = names

# ---- delete motion-blur discs and radome internals (hidden behind the opaque radome)
for n in ['fan_1_fast', 'fan_2_fast', 'fan_3_fast', 'Cube', 'Cube.003', 'Cube.004',
          'Cylinder.005', 'Cylinder.015', 'fuselage.001', 'fuselage.cone_2']:
    bpy.data.objects.remove(O[n])

# ---- grounding: main gear is modelled fully extended; compress it like FG does on the ground
def bottom(n): return bbox([O[n]])[0].z
main_b = min(bottom(n) for n in ['tyres.left.front', 'tyres.left.back', 'tyres.right.front', 'tyres.right.back'])
center_b, nose_b = bottom('tyres.central'), bottom('tyres')
MAIN_COMP = (center_b - main_b) / 0.3          # FG: lower strut rises 0.3 m per unit compression
ground_z = max(nose_b, center_b)               # tyres touch or sink <= ~2 cm (tyre deflection)
mid_x = (bbox([O['tyres.left.front']])[0].x + bbox([O['tyres.left.back']])[1].x) / 2
OFFSET = Vector((mid_x, 0, ground_z))
print(f'GROUND main_b={main_b:.3f} center_b={center_b:.3f} nose_b={nose_b:.3f} comp={MAIN_COMP:.3f} offset={tuple(round(c,3) for c in OFFSET)}')
for ob in O:
    if ob.type == 'MESH':
        ob.data.transform(Matrix.Translation(-OFFSET))
def P(x, y, z): return fgp(x, y, z) - OFFSET
def AX(x, y, z): return Vector((-x, -y, z)).normalized()
def AX2(p1, p2): return (P(*p2) - P(*p1)).normalized()

# ---- helpers
def join(new_name, parts):
    obs = [O[p] for p in parts]
    if len(obs) > 1:
        with bpy.context.temp_override(active_object=obs[0], selected_editable_objects=obs):
            bpy.ops.object.join()
    obs[0].name = new_name; obs[0].data.name = new_name
    return obs[0]

def set_pivot(ob, pivot_world, parent=None):
    """Move the object's origin to pivot_world (rest rotation stays identity) and parent it."""
    ob.data.transform(Matrix.Translation(-(pivot_world - ob.matrix_world.translation)))
    ob.matrix_world = Matrix.Translation(pivot_world)
    if parent is not None:
        ob.parent = parent
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.location = pivot_world - parent.matrix_world.translation
    ob.rotation_mode = 'QUATERNION'
    return ob

def closest_on_line(p, a, d):
    return a + d * (p - a).dot(d)

def center(ob):
    mn, mx = bbox([ob]); return (mn + mx) / 2

# ---- fans: align each fan's true spin axis with +X so code can spin around local X
for name, parts, p1, p2 in [
        ('Fan_L', ['fan_1', 'fan_1.center'], (-4.8064, -8.2552, 3.4790), (-5.2843, -8.2413, 3.4790)),
        ('Fan_R', ['fan_3', 'fan_3.center'], (-4.8064, 8.2552, 3.4790), (-5.2843, 8.2413, 3.4790)),
        ('Fan_C', ['fan_2', 'fan_2.center'], (25.7008, 0, 10.6838), (25.2229, 0, 10.6977))]:
    ob = join(name, parts)
    d = AX2(p1, p2)
    if d.x < 0: d = -d
    piv = closest_on_line(center(ob), P(*p1), d)
    q = d.rotation_difference(Vector((1, 0, 0)))
    ob.data.transform(Matrix.Translation(piv) @ q.to_matrix().to_4x4() @ Matrix.Translation(-piv))
    set_pivot(ob, piv)
    ob['spin_axis'] = 'x'

# ---- gear legs and their sub-assemblies
anim = {}   # object name -> dict(kind, ...) evaluated per frame

def rot_track(ob, axis, table, src='pos'):
    anim[ob.name] = dict(kind='rot', axis=axis, table=table, src=src)

nose = set_pivot(join('Gear_Nose', ['front.strut.high', 'front.strut.low', 'tyres', 'nose.scissor.down', 'nose.scissor.up']),
                 P(-20.1889, 0, 3.9978))
rot_track(nose, AX(0, 1, 0), [(0.3, 85), (0.8, 0)])
nb = set_pivot(join('Gear_Nose_Brace', ['nose.arm1']), P(-20.5624, 0, 2.7259), nose)
rot_track(nb, AX(0, -1, 0), [(0.3, 120), (0.8, 0)])

def main_gear(side, s):  # side 'L' (FG left, y<0) / 'R'; s = -1 for left, +1 for right in FG y
    fg = 'left' if side == 'L' else 'right'
    leg = set_pivot(join(f'Gear_Main_{side}', [f'{fg}.strut.up']), P(3.9577, 5.2960 * s, 4.5600))
    rot_track(leg, AX(-1, 0, 0), [(0.3, 87 * s), (0.8, 0)])
    oleo_c, sdoor_c = center(O[f'{fg}.strut.low']), center(O[f'{fg}.main.door'])
    oleo = set_pivot(join(f'Gear_Main_{side}_Oleo', [f'{fg}.strut.low', f'{fg}.strut.low2',
                     f'tyres.{fg}.front', f'tyres.{fg}.back']), oleo_c, leg)
    anim[oleo.name] = dict(kind='oleo')
    sd = set_pivot(join(f'Gear_Main_{side}_ScissorLow', [f'{fg}.scissor.down']), P(4.2541, 5.2960 * s, 1.4989), oleo)
    anim[sd.name] = dict(kind='rot_comp', axis=AX(0, -1, 0), table=[(0, 0), (1, -35), (2, -62)])
    su = set_pivot(join(f'Gear_Main_{side}_ScissorUp', [f'{fg}.scissor.up']), P(4.2616, 5.2960 * s, 2.2707), leg)
    anim[su.name] = dict(kind='rot_comp', axis=AX(0, -1, 0), table=[(0, 0), (1, 35), (2, 62)])
    sdoor = set_pivot(join(f'GearDoor_Main_{side}_Strut', [f'{fg}.main.door']), sdoor_c, leg)
    a1p1, a1p2 = (3.7564, 5.3027 * s, 3.4440), (3.6452, 5.2677 * s, 3.4345)
    b1 = set_pivot(join(f'Gear_Main_{side}_Brace1', [f'{fg}.arm1']), P(*a1p1), leg)
    rot_track(b1, AX2(a1p1, a1p2), [(0.3, 81.8 * s), (0.8, 0)])
    a2p1, a2p2 = (4.0949, 4.4307 * s, 3.7505), (3.9091, 4.3633 * s, 3.7279)
    b2 = set_pivot(join(f'Gear_Main_{side}_Brace2', [f'{fg}.arm2']), P(*a2p1), b1)
    rot_track(b2, AX2(a2p1, a2p2), [(0.5, -180 * s), (0.8, 0)])
    a3p1, a3p2 = (3.9571, 4.3919 * s, 3.7688), (3.9954, 4.3948 * s, 3.7695)
    b3 = set_pivot(join(f'Gear_Main_{side}_Brace3', [f'{fg}.arm3']), P(*a3p1), b1)
    rot_track(b3, AX2(a3p1, a3p2), [(0.5, -50 * s), (0.8, 0)])
    door = set_pivot(join(f'GearDoor_Main_{side}', [f'main.{fg}.door']), P(0, 1.2372 * s, 3.5159))
    rot_track(door, AX(-s, 0, 0), [(0.0, 0), (0.15, 75), (0.70, 75), (1.0, 0)])
main_gear('L', -1)
main_gear('R', 1)

cen = set_pivot(join('Gear_Center', ['central.strut.up', 'central.strut.low', 'central.scissor.up',
                                     'central.scissor.down', 'tyres.central']), P(5.35, 0, 4.04))
rot_track(cen, AX(0, -1, 0), [(0.4, -80), (0.8, 0)])

for side, s, fl in [('L', -1, 'left'), ('R', 1, 'right')]:
    d = set_pivot(join(f'GearDoor_Center_{side}', [f'central.front.{fl}']), P(0, 0.8540 * s, 3.4678))
    rot_track(d, AX(1, 0, 0), [(0.0, 0), (0.15, 75 * s), (0.70, 75 * s), (1.0, 0)])
    d = set_pivot(join(f'GearDoor_Center_Aft{side}', [f'central.back.{fl}']), P(0, 0.8540 * s, 3.4678))
    rot_track(d, AX(1, 0, 0), [(0.1, -50 * s), (0.7, 0)])
    p1, p2 = (-23.0503, 0.6570 * s, 3.7495), (-21.1417, 0.6746 * s, 3.5362)
    d = set_pivot(join(f'GearDoor_Nose_{side}', [f'lgdoor.{fl}.front']), P(*p1))
    rot_track(d, AX2(p1, p2), [(0.0, 0), (0.3, 75 * s), (0.7, 75 * s), (1.0, 10 * s)])
    p1, p2 = (-21.0623, 0.5647 * s, 3.4945), (-19.9820, 0.5358 * s, 3.4194)
    d = set_pivot(join(f'GearDoor_Nose_Aft{side}', [f'lgdoor.{fl}.front.2']), P(*p1))
    rot_track(d, AX2(p1, p2), [(0.1, 0), (0.3, 90 * s)])

# ---- control surfaces with hinge axes (glTF frame) stored as custom properties
def gltf_vec(v): return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]
def hinge(name, parts, p1, p2, te_dir):
    ob = join(name, parts)
    a = AX2(p1, p2)
    c = center(ob)
    piv = closest_on_line(c, P(*p1), a)
    # orient the axis so a positive rotation moves the trailing edge toward te_dir
    arm = c - piv
    if (a.cross(arm)).dot(te_dir) < 0: a = -a
    set_pivot(ob, piv)
    ob['hinge_axis'] = gltf_vec(a)
    return ob
hinge('Rudder', ['rudder.u', 'rudder_trailing.u', 'rudder.l', 'rudder_trailing.l'],
      (29.4514, 0, 18.6337), (25.8846, 0, 13.0407), Vector((0, 1, 0)))
O['Rudder']['hinge_note'] = 'positive angle = trailing edge toward +Y (aircraft left)'
for side, s, parts in [('L', -1, ['elevator.1i', 'elevator.1o']), ('R', 1, ['elevator.2i', 'elevator.2o'])]:
    ob = hinge(f'Elevator_{side}', parts, (28.6007, 8.7874 * s, 8.25817),
               (24.9846, 1.2285 * s, 6.9642), Vector((0, 0, -1)))
    ob['hinge_note'] = 'positive angle = trailing edge down'

# ---- lights
def emissive_mat(name, rgb):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*[c * 0.35 for c in rgb], 1)
    b.inputs['Roughness'].default_value = 0.15
    b.inputs['Emission Color'].default_value = (*rgb, 1)
    b.inputs['Emission Strength'].default_value = 0.0
    m['light_color'] = list(rgb)
    return m

def assign_only(ob, mat):
    ob.data.materials.clear(); ob.data.materials.append(mat)
    for p in ob.data.polygons: p.material_index = 0

def split_faces(src, new_name, pred):
    """Move faces whose world-space centre satisfies pred into a new object."""
    me = src.data.copy(); new = bpy.data.objects.new(new_name, me)
    bpy.context.scene.collection.objects.link(new); new.matrix_world = src.matrix_world
    for ob, keep in ((src, lambda c: not pred(c)), (new, pred)):
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep(ob.matrix_world @ f.calc_center_median())], context='FACES')
        bm.to_mesh(ob.data); bm.free()
    new.data.name = new_name
    return new

nav_split = P(14.0, 0, 0).x  # forward of FG x=14.0 is the coloured nav lens, aft is the white position light
L = split_faces(O['wing.glass.left'], 'Light_Nav_L', lambda c: c.x > nav_split)
R = split_faces(O['wing.glass.right'], 'Light_Nav_R', lambda c: c.x > nav_split)
assign_only(L, emissive_mat('Light_Nav_L', (1.0, 0.05, 0.03)))
assign_only(R, emissive_mat('Light_Nav_R', (0.05, 1.0, 0.25)))
for ob in (L, R): set_pivot(ob, center(ob))
O['Sphere'].name = 'Light_Beacon_Top'; O['Sphere.001'].name = 'Light_Beacon_Bottom'
for n in ('Light_Beacon_Top', 'Light_Beacon_Bottom'):
    O[n].data.name = n
    assign_only(O[n], emissive_mat(n, (1.0, 0.06, 0.02)))
    set_pivot(O[n], center(O[n]))

def lens(name, centres, radius, normal, parent=None):
    bm = bmesh.new()
    for c in centres:
        r = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=radius)
        q = Vector((0, 0, 1)).rotation_difference(normal)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((1, 1, 0.45, 1)), verts=r['verts'])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    set_pivot(ob, sum(centres, Vector()) / len(centres), parent)
    return ob

# tail light: aft tip of the lower tail cone (below the centre engine, not the fairing above it)
fus = O['fuselage']
eng_z = O['Fan_C'].matrix_world.translation.z
tip = min((fus.matrix_world @ v.co for v in fus.data.vertices if (fus.matrix_world @ v.co).z < eng_z - 1.6), key=lambda p: p.x)
st = lens('Light_Strobe_Tail', [tip + Vector((0.02, 0, 0))], 0.09, Vector((-1, 0, 0)))
assign_only(st, emissive_mat('Light_Strobe_Tail', (1.0, 1.0, 1.0)))
ll = lens('Light_Landing', [P(-20.42, -0.19, 3.24), P(-20.42, 0.19, 3.24)], 0.085, Vector((1, 0, 0)), nose)
assign_only(ll, emissive_mat('Light_Landing', (1.0, 0.85, 0.62)))

# ---- everything else is static airframe
moving_prefix = ('Fan_', 'Gear_', 'GearDoor_', 'Light_', 'Rudder', 'Elevator_')
static = [o.name for o in O if o.type == 'MESH' and not o.name.startswith(moving_prefix)]
air = join('Airframe', static)
air.matrix_world = Matrix.Identity(4)

# ---- root empty + parenting
root = bpy.data.objects.new('Trijet', None); bpy.context.scene.collection.objects.link(root)
root.empty_display_size = 5
for ob in O:
    if ob is root or ob.parent is not None: continue
    mw = ob.matrix_world.copy(); ob.parent = root; ob.matrix_parent_inverse = Matrix.Identity(4); ob.matrix_world = mw

# ---- GearRetract action (one slotted action shared by all gear objects)
sc = bpy.context.scene
sc.render.fps = FPS; sc.frame_start = 0; sc.frame_end = F_END
act = bpy.data.actions.new('GearRetract')
OLEO_LIFT = 0.3 * MAIN_COMP

def smooth(t): t = min(max(t, 0), 1); return t * t * (3 - 2 * t)
def state(f):
    comp = MAIN_COMP * (1 - smooth(f / F_OLEO))
    pos = 1 - smooth((f - F_OLEO) / (F_END - F_OLEO))
    return comp, pos

rest_loc = {n: O[n].location.copy() for n in anim}
for n, a in anim.items():
    ob = O[n]
    ob.animation_data_create(); ob.animation_data.action = act
    if ob.animation_data.action_slot is None:
        slot = act.slots.new(id_type='OBJECT', name=n); ob.animation_data.action_slot = slot
    for f in range(0, F_END + 1, 2 if F_END % 2 == 0 else 1):
        comp, pos = state(f)
        if a['kind'] == 'oleo':
            ob.location = rest_loc[n] + Vector((0, 0, 0.3 * comp))
            ob.keyframe_insert('location', frame=f)
            continue
        val = interp(a['table'], comp if a['kind'] == 'rot_comp' else pos)
        ob.rotation_quaternion = Quaternion(a['axis'], math.radians(val))
        ob.keyframe_insert('rotation_quaternion', frame=f)
for fc in [fc for layer in act.layers for strip in layer.strips for cb in strip.channelbags for fc in cb.fcurves]:
    for k in fc.keyframe_points: k.interpolation = 'LINEAR'
sc.frame_set(0)

# ---- report
tot = 0
for ob in sorted(O, key=lambda o: o.name):
    t = sum(len(p.vertices) - 2 for p in ob.data.polygons) if ob.type == 'MESH' else 0; tot += t
    print(f"OBJ {ob.name:28s} tris={t:6d} origin={tuple(round(c, 3) for c in ob.matrix_world.translation)} parent={ob.parent.name if ob.parent else '-'}")
print('TOTAL TRIS', tot, 'animated', len(anim), 'slots', len(act.slots))
bpy.ops.wm.save_as_mainfile(filepath=out_path)
