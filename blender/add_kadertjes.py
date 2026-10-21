"""
Hangt een paar kaders met foto's aan de achterwand van de kamer van de jaren '80 (zoals bij bomma),
rechtstreeks in room.blend — de objecten heten d80_kader_* en hangen onder d70_diorama.001, zodat
build_room80.py ze meebakt. Opnieuw uitvoeren vervangt de bestaande kaders.

  blender -b ~/Downloads/room.blend --python blender/add_kadertjes.py -- blender/kadertjes
"""
import bpy, bmesh, math, os, sys
from mathutils import Matrix, Vector

FOTOS = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
ROOM = bpy.data.objects['d70_diorama.001']
WALL_Y = 1.14           # voorkant van het paneel (kijkt naar -y, de kamer in)
O = bpy.data.objects

# oude kaders weg (opnieuw uitvoeren moet kunnen)
for o in [o for o in O if o.name.startswith('d80_kader')]:
    O.remove(o, do_unlink=True)
for m in [m for m in bpy.data.materials if m.name.startswith('d80_kader')]:
    bpy.data.materials.remove(m)
for me in [me for me in bpy.data.meshes if me.name.startswith('d80_kader') and me.users == 0]:
    bpy.data.meshes.remove(me)

def mat_plain(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m

def mat_photo(name, path):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    t = nt.nodes.new('ShaderNodeTexImage')
    img = bpy.data.images.load(path, check_existing=True)
    img.pack()
    t.image = img
    p = nt.nodes['Principled BSDF']
    p.inputs['Roughness'].default_value = 0.35
    nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
    return m

# houtkleuren zoals een oude lijst: goudbruin, donker notelaar, crème, zwart, wit
WOOD = {
    'goud': (0.55, 0.38, 0.12), 'noot': (0.12, 0.065, 0.035), 'creme': (0.78, 0.72, 0.58),
    'zwart': (0.025, 0.025, 0.025), 'wit': (0.82, 0.80, 0.74), 'eiken': (0.30, 0.17, 0.08),
}
MAT = (0.88, 0.84, 0.72)  # passe-partout

def build_frame(name, w, h, border, wood, photo, shape='rect', mat_w=0.025, depth=0.028, tilt=0.0, at=(0, 0)):
    """w×h = buitenmaat (m); border = breedte van de lijst; shape: 'rect' of 'oval'"""
    bm = bmesh.new()
    n = 48 if shape == 'oval' else 4

    def ring(rx, ry, z):
        if shape == 'oval':
            return [bm.verts.new((math.cos(2 * math.pi * i / n) * rx, math.sin(2 * math.pi * i / n) * ry, z)) for i in range(n)]
        return [bm.verts.new(p) for p in ((-rx, -ry, z), (rx, -ry, z), (rx, ry, z), (-rx, ry, z))]

    # profiel van de lijst, van buiten naar binnen: (inset, hoogte) — een trapje met een opstaande rand en een afschuining
    ox, oy = w / 2, h / 2
    prof = [(0, 0.0), (0, depth * 0.55), (border * 0.22, depth * 0.78), (border * 0.5, depth), (border * 0.78, depth * 0.72), (border, depth * 0.45), (border, 0.004)]
    rings = [ring(ox - i, oy - i, z) for i, z in prof]
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    # geen achterkant: die ligt tegen de muur. Een grote vlakke achterkant zou in build_room80.py (die vlakke d80_-objecten
    # die naar de muur wijzen omdraait, bedoeld voor de gordijnen) de hele lijst binnenstebuiten keren.
    inner = rings[-1]
    # passe-partout: vlak net onder de lijst, met opening voor de foto
    mx, my = ox - border, oy - border
    px, py = mx - mat_w, my - mat_w
    mring = ring(px, py, 0.004)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((inner[i], inner[j], mring[j], mring[i]))
        mring_i = mring
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # materiaalslots: 0 hout, 1 passe-partout
    for f in bm.faces:
        f.material_index = 0
    for f in bm.faces:
        vs = [v for v in f.verts]
        if all(any(v is m for m in mring) or any(v is m for m in inner) for v in vs) and any(any(v is m for m in mring) for v in vs):
            f.material_index = 1
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat_plain(name + '_hout', WOOD[wood], rough=0.45, metal=0.0))
    me.materials.append(mat_plain(name + '_passepartout', MAT, rough=0.9))
    for p in me.polygons:
        p.use_smooth = False
    frame = bpy.data.objects.new(name, me)

    # de foto zelf: vlak, UV 0..1 over de opening
    bmp = bmesh.new()
    if shape == 'oval':
        vs = [bmp.verts.new((math.cos(2 * math.pi * i / n) * px, math.sin(2 * math.pi * i / n) * py, 0.002)) for i in range(n)]
        c = bmp.verts.new((0, 0, 0.002))
        for i in range(n):
            bmp.faces.new((c, vs[i], vs[(i + 1) % n]))
    else:
        vs = [bmp.verts.new(p) for p in ((-px, -py, 0.002), (px, -py, 0.002), (px, py, 0.002), (-px, py, 0.002))]
        bmp.faces.new(vs)
    # de foto vult de opening zonder uit te rekken: wat uitsteekt valt weg (zoals 'cover' in css)
    pmat = mat_photo(name + '_foto', os.path.join(FOTOS, photo))
    iw, ih = next(n.image.size for n in pmat.node_tree.nodes if n.type == 'TEX_IMAGE')
    a = (iw / ih) / (px / py)
    su, sv = (1 / a, 1.0) if a > 1 else (1.0, a)
    uv = bmp.loops.layers.uv.new('UVMap')
    for f in bmp.faces:
        for l in f.loops:
            co = l.vert.co
            l[uv].uv = (0.5 + (co.x / (2 * px)) * su, 0.5 + (co.y / (2 * py)) * sv)
    pme = bpy.data.meshes.new(name + '_foto')
    bmp.to_mesh(pme)
    bmp.free()
    pme.materials.append(pmat)
    photo_obj = bpy.data.objects.new(name + '_foto', pme)

    # in de kamer plaatsen: de achterkant tegen de muur (lokale +z = naar de kamer = -y), een beetje scheef
    x, z = at
    rot = Matrix.Rotation(math.radians(tilt), 4, 'Y') if False else None
    M = (Matrix.Translation(Vector((ROOM.matrix_world.translation.x + x, WALL_Y, z)))
         @ Matrix.Rotation(math.pi / 2, 4, 'X')                 # lokale z → -y; lokale y → +z
         @ Matrix.Rotation(math.radians(tilt), 4, 'Z'))
    bpy.context.collection.objects.link(frame)
    bpy.context.collection.objects.link(photo_obj)
    frame.matrix_world = M
    photo_obj.parent = frame
    for ob in (frame,):
        ob.parent = ROOM
        ob.matrix_parent_inverse = ROOM.matrix_world.inverted()
    return frame

# De kaders, in meters; x is t.o.v. het midden van de kamer (diorama, x=14.12), z de hoogte van het midden.
# Tussen het raam (tot x=14.04) en de tv (vanaf 15.3), met één boven de tv; de lichtschakelaar blijft vrij.
cx = ROOM.matrix_world.translation.x
# Alle kaders hebben een echte foto uit de jaren '80 (de .jpg's; _pd = public domain, Wikimedia Commons).
KADERS = [
    ('d80_kader_zee',      0.46, 0.34, 0.040, 'goud',  'foto_zee_1983.jpg',     'rect', dict(at=(14.72 - cx, 1.92), tilt=1.5)),
    ('d80_kader_portret',  0.23, 0.29, 0.030, 'noot',  'foto_portret_1982.jpg', 'oval', dict(at=(14.33 - cx, 1.50), tilt=-2.0)),
    ('d80_kader_bruiloft', 0.25, 0.33, 0.028, 'eiken', 'foto_bruiloft_1989_pd.jpg', 'rect', dict(at=(14.64 - cx, 1.50), tilt=1.0)),
    ('d80_kader_chalet',   0.19, 0.19, 0.020, 'wit',   'foto_chalet_1985_pd.jpg', 'rect', dict(at=(14.99 - cx, 1.50), tilt=-1.5)),
    ('d80_kader_bloemen',  0.17, 0.22, 0.018, 'creme', 'foto_bloemen_1980s_pd.jpg', 'rect', dict(at=(14.63 - cx, 1.12), tilt=2.5)),
    ('d80_kader_bergen',   0.42, 0.31, 0.034, 'zwart', 'foto_bergen_1982.jpg', 'rect', dict(at=(15.66 - cx, 2.06), tilt=-1.0)),
]
for name, w, h, border, wood, photo, shape, kw in KADERS:
    build_frame(name, w, h, border, wood, photo, shape, **kw)
    print('KADER', name, kw['at'])

# de spijkertjes waaraan ze hangen komen er in three bij (src/frames.js): je ziet ze pas als je een kader van de muur haalt
bpy.ops.wm.save_mainfile()
print('OPGESLAGEN', bpy.data.filepath)
