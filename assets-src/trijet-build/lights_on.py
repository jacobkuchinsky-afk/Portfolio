# Preview helper: turn the Light_* emitters on, then render with render.py.
import bpy
for m in bpy.data.materials:
    if m.name.startswith('Light_'):
        m.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 40
exec(open('render.py').read())
