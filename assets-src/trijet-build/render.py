# Render preview views of a stage .blend without modifying it.
# Usage: blender -b <file.blend> -P render.py -- <out_prefix> <view>[,<view>...] [frame] [res]
# Views: side, front34, rear34, top, bottom, front, nose, mains, tail, wing, engine, cockpit
import bpy, sys, math
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
prefix, views = args[0], args[1].split(',')
frame = int(args[2]) if len(args) > 2 else None
res = int(args[3]) if len(args) > 3 else 1600
sc = bpy.context.scene
if frame is not None:
    sc.frame_set(frame)
for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try:
        sc.render.engine = eng; break
    except TypeError:
        pass
aspect = 0.32 if 'gearside' in views else 0.5
sc.render.resolution_x, sc.render.resolution_y = res, int(res * aspect)
sc.render.film_transparent = False
sc.view_settings.view_transform = 'Khronos PBR Neutral'
try:
    sc.eevee.use_shadows = True
    sc.eevee.use_raytracing = True
except AttributeError:
    pass

w = bpy.data.worlds.new('preview_world'); sc.world = w
w.use_nodes = True
nt = w.node_tree; bg = nt.nodes['Background']
sky = nt.nodes.new('ShaderNodeTexSky')
try:
    sky.sky_type = 'NISHITA'
except TypeError:
    pass
sky.sun_elevation = math.radians(35); sky.sun_rotation = math.radians(200)
nt.links.new(sky.outputs[0], bg.inputs[0]); bg.inputs[1].default_value = 0.35

sun_d = bpy.data.lights.new('preview_sun', 'SUN'); sun_d.energy = 4.0; sun_d.angle = math.radians(2)
sun = bpy.data.objects.new('preview_sun', sun_d); sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))

gm = bpy.data.meshes.new('preview_ground')
gm.from_pydata([(-400, -400, 0), (400, -400, 0), (400, 400, 0), (-400, 400, 0)], [], [(0, 1, 2, 3)])
g = bpy.data.objects.new('preview_ground', gm); sc.collection.objects.link(g)
gmat = bpy.data.materials.new('preview_ground'); gmat.use_nodes = True
gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.22, 0.23, 0.24, 1)
gmat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
gm.materials.append(gmat)

cam_d = bpy.data.cameras.new('preview_cam'); cam = bpy.data.objects.new('preview_cam', cam_d)
sc.collection.objects.link(cam); sc.camera = cam

VIEWS = {  # name: (location, target, lens_mm, ortho_scale or None)
    'side': ((2, -400, 6), (2, 0, 6), None, 66),
    'front34': ((99, -70, 13), (4, 0, 4), 50, None),
    'rear34': ((-90, -70, 18), (0, 0, 6), 50, None),
    'top': ((0, 0, 300), (0, 0, 0), None, 66),
    'bottom': ((0, 0.01, -300), (0, 0, 0), None, 66),
    'front': ((300, 0, 6), (0, 0, 6), None, 56),
    'nose': ((28, -14, 1.7), (25.5, 0, 2.0), 45, None),
    'mains': ((1, -18, 0.8), (0, 0, 2.0), 40, None),
    'belly': ((6, -9, -4), (1, 0, 2.6), 30, None),
    'tail': ((-30, -24, 13), (-24, 0, 10), 50, None),
    'wing': ((-10, -14, 21), (6, 14, 4), 40, None),
    'engine': ((18, -18, 2.2), (8.5, -8.2, 2.6), 50, None),
    'cockpit': ((40, -8, 5.2), (30, 0, 4.2), 60, None),
    'gearside': ((12, -400, 3.2), (12, 0, 3.2), None, 36),
    'tailcone': ((-36, -9, 8), (-28, 0, 9), 40, None),
    'wingtip': ((-4, 30, 9), (-9, 25, 5.3), 40, None),
}
for v in views:
    loc, tgt, lens, ortho = VIEWS[v]
    cam.location = loc
    d = Vector(tgt) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam_d.type = 'ORTHO'; cam_d.ortho_scale = ortho
    else:
        cam_d.type = 'PERSP'; cam_d.lens = lens
    cam_d.clip_end = 2000
    sc.render.filepath = f"{prefix}_{v}.png"
    bpy.ops.render.render(write_still=True)
    print('WROTE', sc.render.filepath)
