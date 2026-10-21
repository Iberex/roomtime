"""
Bouwt de web-assets van de kamer uit de jaren '80 uit room.blend:
  - houdt enkel het tweede diorama over (d70_diorama.001 en alles eronder, ook de d80_*-objecten)
  - maakt een lightmap-UV en bakt het volledige beeld (kleur × licht + emissie) met Cycles
  - exporteert public/models/kamer80.glb en twee bakes (× 0.5 opgeslagen, in three × 2):
      baked80.webp       de kamer zonder daglicht      baked80_dag.webp   enkel het licht door het raam
    In three: kleur = basis + daglicht × (hoe ver de gordijnen open zijn).
  - het raamglas wordt niet gebakken: in three is het een doorzichtig materiaal

In de browser staat deze kamer rug aan rug achter de muur van de jaren '70 (draaitoneel),
die plaatsing gebeurt in main.js: hier blijft alles op zijn plek in room.blend.

Gebruik:
  blender -b ~/Downloads/room.blend --python blender/build_room80.py -- <projectmap> [samples] [resolutie] [GPU|CPU]
  (CPU als Metal ermee stopt met 'Command buffer not completed': trager, maar het lukt altijd)
"""
import bpy, sys, math, os
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
ROOT = args[0]
SAMPLES = int(args[1]) if len(args) > 1 else 512
SIZE = int(args[2]) if len(args) > 2 else 4096
DEVICE = args[3].upper() if len(args) > 3 else 'GPU'
SCALE = 0.5
ROOM = 'd70_diorama.001'
GLASS = {'d80_raam_glas'}

scene = bpy.context.scene

# ---------- 0. werkt ook op room_draaitoneel.blend ----------
# Daar staat de kamer al 180° gedraaid achter de muur van de jaren '70; de site doet dat draaien zelf,
# dus hier eerst terugdraaien (rond dezelfde as als make_turntable_blend.py).
from mathutils import Matrix, Vector
d80 = bpy.data.objects[ROOM]
if abs(math.cos(d80.matrix_world.to_euler().z) + 1) < 1e-3:
    wall = bpy.data.objects['d70_muur']
    axis = Vector((bpy.data.objects['d70_diorama'].matrix_world.translation.x,
                   max((wall.matrix_world @ Vector(c)).y for c in wall.bound_box) + 0.015, 0))
    d80.matrix_world = Matrix.Translation(axis) @ Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Translation(-axis) @ d80.matrix_world
    bpy.context.view_layer.update()
    print('UNROTATED', ROOM, flush=True)

# ---------- 1. alleen het diorama van de jaren '80 ----------
keep = set()
def collect(o):
    keep.add(o.name)
    for c in o.children:
        collect(c)
collect(bpy.data.objects[ROOM])
keep.add('Camera')
# losse objecten (de cassettes: je pakt ze op en legt ze in de radio; de kaders: je haalt ze van de muur) werpen
# geen schaduw in de bake van de kamer, anders blijft hun schaduw op de tafel of de muur staan als ze weg zijn.
# Ze worden wel beschenen.
LOOSE = set()
def collect_loose(o, inside=False):
    inside = inside or o.name.startswith(('d80_cassette', 'd80_kader'))
    if inside:
        LOOSE.add(o.name)
    for c in o.children:
        collect_loose(c, inside)
collect_loose(bpy.data.objects[ROOM])
for o in list(bpy.data.objects):
    if o.name not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.outliner.orphans_purge(do_recursive=True)
O = bpy.data.objects
# in de render verborgen objecten (snijvormen van booleans, hulpvormen van BlenderKit-modellen) doen niet mee;
# ze blijven wel bestaan tot de modifiers die ernaar verwijzen toegepast zijn
helpers = [o for o in O if o.hide_render]
for o in O:
    o.hide_set(False)  # anders kan Blender ze niet selecteren voor het baken

# doorzichtige objecten (raam, cassettedoosjes) worden niet gebakken maar in three doorzichtig getekend;
# ze krijgen '_glas' achter hun naam zodat de site ze herkent
def transparent(o):
    # enkel als álle materialen doorzichtig zijn: een klepje met een ruitje erin blijft gewoon gebakken
    def clear(m):
        if not (m and m.use_nodes):
            return False
        if any(n.type in ('BSDF_GLASS', 'BSDF_TRANSPARENT') for n in m.node_tree.nodes):
            return True
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        return bool(bsdf) and (bsdf.inputs['Transmission Weight'].default_value > 0.5 or bsdf.inputs['Alpha'].default_value < 0.5)
    mats = [s.material for s in o.material_slots if s.material]
    return bool(mats) and all(clear(m) for m in mats)
for o in O:
    if o.type == 'MESH' and o not in helpers and (o.name in GLASS or transparent(o)):
        GLASS.add(o.name)
        if not o.name.endswith('_glas'):
            o.name += '_glas'
            GLASS.add(o.name)
print('GLASS', sorted(GLASS), flush=True)

# ---------- 2. lightmap UV ----------
bake_objs = [o for o in O if o.type == 'MESH' and o.name not in GLASS and o not in helpers]
for o in bake_objs:
    if not o.modifiers:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    if o.data.users > 1:
        o.data = o.data.copy()
    for m in list(o.modifiers):
        if not m.show_render:
            o.modifiers.remove(m)  # staat uit in de render: telt niet mee
            continue
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError as err:
            print('SKIP MODIFIER', o.name, m.name, err, flush=True)
            o.modifiers.remove(m)
for o in helpers:
    bpy.data.objects.remove(o, do_unlink=True)
print('HELPERS REMOVED', len(helpers), flush=True)

# kleine objecten met absurd veel driehoeken (de schroefjes in de cassettes: 160.000 elk) vereenvoudigen
for o in bake_objs:
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris > 30000 and max(o.dimensions) < 0.3:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        if o.data.users > 1:
            o.data = o.data.copy()
        dec = o.modifiers.new('Vereenvoudig', 'DECIMATE')
        dec.ratio = 1500 / tris
        bpy.ops.object.modifier_apply(modifier=dec.name)
        print('DECIMATED', o.name, tris, '->', len(o.data.polygons), flush=True)
for o in bake_objs:
    if o.data.users > 1:
        o.data = o.data.copy()  # eigen lightmap per object, ook bij gedeelde meshes
# de schaal van de objecten in de meshes zelf zetten. BlenderKit-modellen staan vaak op een kleine schaal
# (een cassette op 0.04, een motortje op 0.008): hun mesh is dan tientallen keren te groot en Smart UV
# Project geeft ze een even groot stuk van de lightmap. Muren en vloer kregen zo amper pixels.
# Eerst de hiërarchie plat maken (wereldpositie blijft), dan per object de schaal in de mesh.
_mw = {o.name: o.matrix_world.copy() for o in O}
for o in O:
    if o.parent:
        o.parent = None
        o.matrix_world = _mw[o.name]
for o in bake_objs:
    loc, rot, sc = _mw[o.name].decompose()
    if max(abs(sc.x - 1), abs(sc.y - 1), abs(sc.z - 1)) > 1e-4:
        o.data.transform(Matrix.Diagonal(sc).to_4x4())
        if sc.x * sc.y * sc.z < 0:
            o.data.flip_normals()
        o.matrix_world = Matrix.LocRotScale(loc, rot, Vector((1, 1, 1)))
bpy.context.view_layer.update()
# dunne vlakken (gordijnen) waarvan de normalen naar de muur wijzen, bakken zwart: omdraaien naar de kamer
from mathutils import Vector
for o in bake_objs:
    dims = sorted(o.dimensions)
    flat = dims[0] < 0.15 * dims[1]  # enkel platte vlakken; een stekker of doosje niet
    n = sum((p.normal * p.area for p in o.data.polygons), Vector())
    if o.name.startswith('d80_') and flat and n.length and (o.matrix_world.to_3x3() @ n).normalized().y > 0.5:
        o.data.flip_normals()
        print('FLIPPED', o.name, flush=True)
    me = o.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    render_uv = next((l for l in me.uv_layers if l.active_render), me.uv_layers[0])
    if 'Lightmap' not in me.uv_layers:
        me.uv_layers.new(name='Lightmap')
    render_uv.active_render = True
    for l in me.uv_layers:
        if l.name == 'UVMap' and l != render_uv:
            l.name = 'UVMap_oud'
    render_uv.name = 'UVMap'
    me.uv_layers.active = me.uv_layers['Lightmap']


def select(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


select(bake_objs)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, scale_to_bounds=False)
bpy.ops.uv.pack_islands(margin=0.003, rotate=True, scale=True)
bpy.ops.object.mode_set(mode='OBJECT')

# ---------- 3. baken ----------
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
if DEVICE == 'GPU':
    prefs.compute_device_type = 'METAL'
    prefs.refresh_devices()
    for d in prefs.devices:
        d.use = True
scene.cycles.device = DEVICE
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = False
scene.cycles.use_denoising = True   # zonder ruis ziet de schaduw er zacht en natuurlijk uit
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.cycles.sample_clamp_indirect = 3.0
# ook geen weerkaatst licht: de achterkant van een foto, 3 mm van de muur, straalde anders haar beeld op het behang
for _n in LOOSE:
    if _n in bpy.data.objects:
        _o = bpy.data.objects[_n]
        _o.visible_shadow = _o.visible_diffuse = _o.visible_glossy = _o.visible_transmission = False

# metaal heeft geen diffuse kleur: zonder glans in de bake wordt het zwart. Tijdens het baken telt
# metaal (de tv, de radio, de pootjes van de zetel) daarom als gewone kleur.
for mat in {s.material for o in bake_objs for s in o.material_slots if s.material}:
    if not mat.use_nodes:
        continue
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            for link in list(n.inputs['Metallic'].links):
                mat.node_tree.links.remove(link)
            n.inputs['Metallic'].default_value = 0.0

# ---------- 3a. kleur per materiaal, scherp ----------
# Kleur en licht apart: het licht is zacht en past in één gedeelde lightmap, maar de kleur van een zetel of
# tv heeft zijn eigen texture van 2048 px nodig. In één bake van de hele kamer kreeg de zetel er maar een
# paar honderd pixels van: ruw en wazig als je inzoomt. Elk materiaal krijgt hier een eigen kleurtexture
# (gebakken op zijn eigen UV, zodat ook kleurverlopen en procedurele stof meekomen); in three is de kleur dan
# texture × lightmap.
SKY = O.get('d80_buiten_lucht')
SKY_MATS = {s.material for s in SKY.material_slots if s.material} if SKY else set()
mats = sorted({s.material for o in bake_objs for s in o.material_slots if s.material} - SKY_MATS, key=lambda m: m.name)

def color_inputs(mat):
    p = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    return p, (p.inputs['Base Color'] if p else None)

def upstream(sock, seen=None):
    seen = set() if seen is None else seen
    for l in sock.links:
        n = l.from_node
        if n in seen:
            continue
        seen.add(n)
        yield n
        for i in n.inputs:
            yield from upstream(i, seen)

def mat_faces(mat):
    """(object, [polygon-indices]) van alle te bakken objecten met dit materiaal"""
    out = []
    for o in bake_objs:
        idx = {i for i, s in enumerate(o.material_slots) if s.material == mat}
        if idx:
            out.append((o, [p.index for p in o.data.polygons if p.material_index in idx]))
    return out

plan = {}  # materiaal -> (grootte, opnieuw uitvouwen)
for mat in mats:
    p, sock = color_inputs(mat)
    nodes = list(upstream(sock)) if sock else []
    imgs = [n.image for n in nodes if n.type == 'TEX_IMAGE' and n.image and n.image.size[0]]
    if not nodes:  # effen kleur: niets te bakken, gewoon invullen
        plan[mat] = (16, None)
        continue
    faces = mat_faces(mat)
    us, area = [], 0.0
    for o, polys in faces:
        uvd = o.data.uv_layers['UVMap'].data
        for pi in polys:
            loops = o.data.polygons[pi].loop_indices
            us += [uvd[l].uv[:] for l in loops]
            if len(loops) >= 3:
                a, b, c = (Vector(uvd[l].uv) for l in loops[:3])
                area += abs((b - a).cross(c - a)) / 2
    us = np.array(us) if us else np.zeros((1, 2))
    inside = us.min() > -0.001 and us.max() < 1.001
    # eigen UV houden als die netjes in [0,1] ligt en een beeld draagt. Getegeld (gordijnen, vloer): dezelfde
    # layout verkleind tot in [0,1], zodat het patroon doorloopt. Geen bruikbare UV: een nieuwe uitvouw.
    redo = False if (imgs and inside and area > 1e-4) else 'fit' if area > 1e-4 else 'unwrap'
    src = max((max(i.size) for i in imgs), default=2048)
    small = max(max(o.dimensions) for o, _ in faces) < 0.15
    size = min(2048, src, 512 if small else 2048)
    plan[mat] = (max(size, 64), redo)
    print('ALBEDO', mat.name, size, redo or 'eigen UV', flush=True)

# nieuwe uitvouw voor de materialen die dat nodig hebben, enkel hun eigen vlakken
for mat, (size, redo) in plan.items():
    if redo != 'fit':
        continue
    faces = mat_faces(mat)
    loops = [(o.data.uv_layers['UVMap'].data, l) for o, polys in faces for pi in polys for l in o.data.polygons[pi].loop_indices]
    uv = np.array([d[l].uv[:] for d, l in loops])
    lo, ext = uv.min(0), (uv.max(0) - uv.min(0)).max() * 1.002
    for (d, l), q in zip(loops, (uv - lo) / ext):
        d[l].uv = q
for mat, (size, redo) in plan.items():
    if redo != 'unwrap':
        continue
    faces = mat_faces(mat)
    for o, polys in faces:
        o.data.uv_layers.active = o.data.uv_layers['UVMap']
        sel = set(polys)
        for p in o.data.polygons:
            p.select = p.index in sel
    select([o for o, _ in faces])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True, scale=True)
    bpy.ops.object.mode_set(mode='OBJECT')
for o in bake_objs:
    for p in o.data.polygons:
        p.select = True

ALBEDO = {}
for mat, (size, redo) in plan.items():
    img = bpy.data.images.new('albedo_' + mat.name, size, size, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    ALBEDO[mat] = img
    if redo is None:
        c = np.array(color_inputs(mat)[1].default_value[:3]) if color_inputs(mat)[1] else np.ones(3) * 0.8
        c = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)
        img.pixels.foreach_set(np.tile(np.append(c, 1.0), size * size).astype(np.float32))
        img.pack()  # anders wist de bake (use_clear) hem niet, maar blijft hij ook bewaard
added = []
scratch = bpy.data.images.new('albedo_wegwerp', 16, 16, alpha=False)
for mat in mats:
    n = mat.node_tree.nodes.new('ShaderNodeTexImage')
    n.image = ALBEDO[mat] if plan[mat][1] is not None else scratch
    mat.node_tree.nodes.active = n
    added.append((mat.node_tree, n))
albedo_objs = [o for o in bake_objs if o != SKY]
for o in albedo_objs:
    o.data.uv_layers.active = o.data.uv_layers['UVMap']
scene.cycles.samples = 16
select(albedo_objs)
bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=16)
scene.cycles.samples = SAMPLES
for nt, n in added:
    nt.nodes.remove(n)
for o in albedo_objs:
    o.data.uv_layers.active = o.data.uv_layers['Lightmap']
print('ALBEDO BAKED', len(ALBEDO), flush=True)

# de lucht achter het raam: enkel licht, geen kleur × licht. Haar kleur is haar emissie.
if SKY:
    for mat in SKY_MATS:
        img = bpy.data.images.new('albedo_' + mat.name, 256, 256, alpha=False)
        n = mat.node_tree.nodes.new('ShaderNodeTexImage')
        n.image = img
        mat.node_tree.nodes.active = n
        ALBEDO[mat] = img
    SKY.data.uv_layers.active = SKY.data.uv_layers['UVMap']
    select([SKY])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.bake(type='EMIT', use_clear=True, margin=4)
    SKY.data.uv_layers.active = SKY.data.uv_layers['Lightmap']

# twee lichtlagen: het daglicht door het raam (zon, daglicht, de lucht) apart van de rest,
# zodat het in de browser wegvalt als je de gordijnen dichtdoet
DAY_LIGHTS = [O[n] for n in ('d80_licht_daglicht', 'd80_licht_zon') if n in O]
OTHER_LIGHTS = [o for o in O if o.type == 'LIGHT' and o not in DAY_LIGHTS]
DAY_MATS = {s.material.name for s in O['d80_buiten_lucht'].material_slots if s.material} if 'd80_buiten_lucht' in O else set()
emitters = []  # (socket, oorspronkelijke sterkte, hoort bij het daglicht)
for mat in {s.material for o in bake_objs for s in o.material_slots if s.material}:
    if not mat.use_nodes:
        mat.use_nodes = True
    for n in mat.node_tree.nodes:
        sock = n.inputs.get('Emission Strength') if n.type == 'BSDF_PRINCIPLED' else n.inputs.get('Strength') if n.type == 'EMISSION' else None
        if sock is not None:
            emitters.append((sock, sock.default_value, mat.name in DAY_MATS))
world_bg = next((n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND'), None) if scene.world and scene.world.use_nodes else None
world_strength = world_bg.inputs['Strength'].default_value if world_bg else 0


def set_layer(day):
    """day=False: kamer zonder daglicht · day=True: enkel het licht door het raam"""
    for o in DAY_LIGHTS:
        o.hide_render = not day
    for o in OTHER_LIGHTS:
        o.hide_render = day
    for sock, value, is_day in emitters:
        sock.default_value = value if is_day == day else 0.0
    if world_bg:
        world_bg.inputs['Strength'].default_value = 0.0 if day else world_strength


def bake(name, kind='LIGHT'):
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    added = []
    for mat in {s.material for o in bake_objs for s in o.material_slots if s.material}:
        nt = mat.node_tree
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        nt.nodes.active = n
        added.append((nt, n))
    select(bake_objs)
    # enkel het licht dat op het oppervlak valt (direct + indirect); de kleur zit in de texture per materiaal
    if kind == 'LIGHT':
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, use_clear=True, margin=8)
    else:
        bpy.ops.object.bake(type='EMIT', use_clear=True, margin=8)
    for nt, n in added:
        nt.nodes.remove(n)

    px = np.empty(SIZE * SIZE * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = np.clip(px.reshape(-1, 4)[:, :3] * SCALE, 0, 1)
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    out = bpy.data.images.new(name + 'Out', SIZE, SIZE, alpha=False)
    out_px = np.ones((SIZE * SIZE, 4), dtype=np.float32)
    out_px[:, :3] = srgb
    out.pixels.foreach_set(out_px.ravel())
    os.makedirs(f'{ROOT}/public/textures', exist_ok=True)
    out.filepath_raw = f'{ROOT}/public/textures/{name}.webp'
    out.file_format = 'WEBP'
    scene.render.image_settings.quality = 92
    out.save()
    print('BAKED', out.filepath_raw, flush=True)


print('DAY', [o.name for o in DAY_LIGHTS], DAY_MATS, 'OTHER', [o.name for o in OTHER_LIGHTS], flush=True)
set_layer(False)
bake('baked80')
bake('baked80_emit', 'EMIT')
set_layer(True)
bake('baked80_dag')

# ---------- 4. export: enkel geometrie (kleur zit in de bake) ----------
# materialen vervangen door enkel hun gebakken kleur: glTF neemt die mee als baseColor-texture (UVMap = TEXCOORD_0),
# de lightmap is TEXCOORD_1
for mat, img in ALBEDO.items():
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    t = nt.nodes.new('ShaderNodeTexImage')
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = 'UVMap'
    t.image = img
    img.file_format = 'WEBP'
    nt.links.new(uvn.outputs['UV'], t.inputs['Vector'])
    nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
    nt.links.new(p.outputs['BSDF'], out.inputs['Surface'])
# het glas wordt in three doorzichtig getekend: zijn textures hoeven niet mee in de GLB
glass_mat = bpy.data.materials.new('glas')
for o in O:
    if o.type == 'MESH' and o.name in GLASS:
        for s in o.material_slots:
            s.material = glass_mat
keep_uv = ('UVMap', 'Lightmap')
for o in bake_objs:
    me = o.data
    for name in [l.name for l in me.uv_layers if l.name not in keep_uv]:
        me.uv_layers.remove(me.uv_layers[name])
    for name in [a.name for a in me.attributes if a.domain == 'CORNER' and a.data_type == 'FLOAT2' and a.name not in keep_uv]:
        me.attributes.remove(me.attributes[name])
    assert [l.name for l in me.uv_layers] == list(keep_uv), (o.name, [l.name for l in me.uv_layers])

bpy.ops.object.select_all(action='DESELECT')
os.makedirs(f'{ROOT}/public/models', exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=f'{ROOT}/public/models/kamer80.glb', export_format='GLB',
    export_lights=False, export_cameras=False, export_apply=True, export_yup=True, export_normals=False,
    export_image_format='WEBP', export_image_quality=88, export_texcoords=True, export_animations=False,
)
print('EXPORT DONE', flush=True)
