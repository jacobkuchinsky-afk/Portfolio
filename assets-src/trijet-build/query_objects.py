import bpy
from mathutils import Vector
for ob in sorted(bpy.data.objects, key=lambda o:o.name):
    vs=[v.co for v in ob.data.vertices]
    mn=Vector(map(min,*vs)) if len(vs)>1 else vs[0]; mx=Vector(map(max,*vs)) if len(vs)>1 else vs[0]
    c=(mn+mx)/2; s=mx-mn
    t=sum(len(p.vertices)-2 for p in ob.data.polygons)
    print(f"{ob.name:28s} tris={t:6d} c=({c.x:7.2f},{c.y:7.2f},{c.z:6.2f}) size=({s.x:6.2f},{s.y:6.2f},{s.z:6.2f}) mats={[m.name.split('|')[1]+':'+m.name.split('|')[3] for m in ob.data.materials]}")
