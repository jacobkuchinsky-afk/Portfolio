# Debug: colour every face by its source part and print the part names near a probe point.
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
m = bpy.data.materials.new('dbg'); m.use_nodes = True; nt = m.node_tree
attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 'part_id'; attr.attribute_type = 'GEOMETRY'
wn = nt.nodes.new('ShaderNodeTexWhiteNoise'); wn.noise_dimensions = '1D'
nt.links.new(attr.outputs['Fac'], wn.inputs['W'])
nt.links.new(wn.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
for ob in bpy.data.objects:
    if ob.type == 'MESH':
        ob.data.materials.clear(); ob.data.materials.append(m)
        for p in ob.data.polygons: p.material_index = 0
