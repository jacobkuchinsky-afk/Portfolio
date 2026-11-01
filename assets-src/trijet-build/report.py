import bpy
bpy.context.scene.frame_set(0)
tot = 0
for ob in sorted(bpy.data.objects, key=lambda o: (o.parent.name if o.parent else '', o.name)):
    t = sum(len(p.vertices) - 2 for p in ob.data.polygons) if ob.type == 'MESH' else 0; tot += t
    o = ob.matrix_world.translation
    print(f"ROW | {ob.name} | {t:,} | ({o.x:.2f}, {o.y:.2f}, {o.z:.2f}) | {ob.parent.name if ob.parent else '-'} |")
print('TOTAL', tot, 'MATS', sorted(m.name for m in bpy.data.materials if m.users), 'IMGS', [(i.name, tuple(i.size)) for i in bpy.data.images])
