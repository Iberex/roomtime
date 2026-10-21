"""
Zet in een kopie van room.blend de kamers op als draaitoneel, zoals op de site:
  - het diorama van de jaren '80 (d70_diorama.001) 180° gedraaid, rug aan rug achter de muur van de jaren '70
    (3 cm spleet tussen de muren, de as van het draaitoneel midden in die spleet)
  - de lucht achter het raam vlak achter de muur, zodat ze niet in de kamer van de jaren '70 steekt
  - de normalen van het rechtergordijn naar de kamer gedraaid (wezen naar de muur: bakt zwart)
  - de lichten van de jaren '80 verlichten en raken enkel de kamer van de jaren '80 (light linking),
    anders schijnt de zon achter het raam in de kamer van de jaren '70
  - een tweede camera (Camera_80) die de jaren '80 bekijkt zoals Camera de jaren '70

Gebruik (room.blend zelf blijft ongemoeid):
  blender -b ~/Downloads/room.blend --python blender/make_turntable_blend.py -- ~/Downloads/room_draaitoneel.blend
"""
import bpy, sys, math
from mathutils import Vector, Matrix

out = sys.argv[sys.argv.index('--') + 1]
O = bpy.data.objects
CORE = 0.03

d70, d80 = O['d70_diorama'], O['d70_diorama.001']
wall = O['d70_muur']
wall_back = max((wall.matrix_world @ Vector(c)).y for c in wall.bound_box)  # achterkant van de muur (y)
axis = Vector((d70.matrix_world.translation.x, wall_back + CORE / 2, 0))
print('AXIS', tuple(round(v, 3) for v in axis))

# ---------- de kamer van de jaren '80 in een eigen collectie ----------
room80 = []
def collect(o):
    room80.append(o)
    for c in o.children:
        collect(c)
collect(d80)
coll = bpy.data.collections.get('Diorama_80') or bpy.data.collections.new('Diorama_80')
if coll.name not in bpy.context.scene.collection.children:
    bpy.context.scene.collection.children.link(coll)
for o in room80:
    for c in list(o.users_collection):
        c.objects.unlink(o)
    coll.objects.link(o)

# ---------- lucht vlak achter de muur (in de ruimte van het diorama, vóór het draaien) ----------
sky = O.get('d80_buiten_lucht')
if sky:
    wall80 = O['d70_muur.001']
    to_local = d80.matrix_world.inverted()
    wall80_back = max((to_local @ wall80.matrix_world @ Vector(c)).y for c in wall80.bound_box)
    sky_y = max((to_local @ sky.matrix_world @ Vector(c)).y for c in sky.bound_box)
    sky.location.y += (wall80_back + CORE / 2) - sky_y

# ---------- rechtergordijn: normalen naar de kamer ----------
cur = O.get('d80_raam_gordijn_rechts')
if cur:
    n = sum((p.normal * p.area for p in cur.data.polygons), Vector())
    if (cur.matrix_world.to_3x3() @ n).y > 0:
        cur.data.flip_normals()
        print('FLIPPED', cur.name)

# ---------- draaien: 180° rond de as ----------
# punt p van de jaren '80 (t.o.v. zijn diorama) komt op as + R(180°)·(p.x, p.y - as.y)
d80.location = Vector((axis.x, 2 * axis.y, d80.location.z))
d80.rotation_euler.z += math.pi

# ---------- light linking: de lichten van de jaren '80 horen bij de jaren '80 ----------
for o in room80:
    if o.type == 'LIGHT':
        o.light_linking.receiver_collection = coll
        o.light_linking.blocker_collection = coll
        print('LINKED', o.name)

# ---------- tweede camera: dezelfde blik op de jaren '80 ----------
cam = O['Camera']
cam80 = O.get('Camera_80') or cam.copy()
if cam80.name != 'Camera_80':
    cam80.name = 'Camera_80'
    bpy.context.scene.collection.objects.link(cam80)
rot = Matrix.Translation(axis) @ Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Translation(-axis)
cam80.matrix_world = rot @ cam.matrix_world

bpy.ops.wm.save_as_mainfile(filepath=out, copy=True)
print('SAVED', out)
