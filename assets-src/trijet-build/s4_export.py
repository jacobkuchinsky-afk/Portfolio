# Stage 4: export trijet.glb and save the working .blend.
# Usage: blender -b stage3.blend -P s4_export.py -- <out.glb> <out.blend>
import bpy, sys
glb, blend = sys.argv[sys.argv.index('--') + 1:][:2]
sc = bpy.context.scene
sc.frame_set(0)
for ob in bpy.data.objects:  # source bookkeeping only, not useful at runtime
    if 'ac_tex' in ob: del ob['ac_tex']
if 'part_names' in sc: del sc['part_names']
for im in bpy.data.images:
    if im.source == 'FILE': im.pack()
bpy.ops.wm.save_as_mainfile(filepath=blend)
want = dict(filepath=glb, export_format='GLB', export_yup=True, export_apply=True, export_animations=True,
            export_animation_mode='ACTIONS', export_extras=True, export_cameras=False, export_lights=False,
            export_draco_mesh_compression_enable=False, export_force_sampling=True, export_frame_range=False,
            export_materials='EXPORT', export_image_format='AUTO', export_texcoords=True, export_normals=True,
            export_tangents=False, export_skins=False, export_morph=False, use_selection=False,
            export_optimize_animation_size=False)
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in props})
print('SKIPPED OPTIONS', [k for k in want if k not in props])
