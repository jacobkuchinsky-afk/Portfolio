# Import the exported .glb into an empty scene, report what came back, then render via render.py.
import bpy, sys
args = sys.argv[sys.argv.index('--') + 1:]
glb = args.pop(0); sys.argv = sys.argv[:sys.argv.index('--') + 1] + args
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene; sc.render.fps = 24
acts = {o.animation_data.action.name for o in bpy.data.objects if o.animation_data and o.animation_data.action}
print('IMPORTED objects', len(bpy.data.objects), 'actions', acts)
exec(open('render.py').read())
