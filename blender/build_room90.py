"""
Bouwt de web-assets van de kamer uit de jaren '90 uit room.blend, op dezelfde manier als build_room80.py:
  - houdt enkel het diorama van de jaren '90 over (d90_diorama en alles eronder)
  - maakt een lightmap-UV, bakt per materiaal een scherpe kleurtexture en één lightmap met Cycles
  - exporteert public/models/kamer90.glb en drie bakes (× 0.5 opgeslagen, in three × 2):
      baked90.webp       de kamer: het grote licht (een plafondlicht, hier toegevoegd) en het vullicht (de lichtschakelaar)
      baked90_lamp.webp  enkel de halogeen-uplighter en zijn kaatsing op het plafond (de knop op de lamp)
      baked90_emit.webp  wat zelf licht geeft: de halogeenkom, de leds
    In three: kleur = kamer × schakelaar + lamp × knop + emissie.
  - geen daglicht: deze kamer heeft geen raam
  - in de render verborgen objecten (de oude zelfgebouwde tv) doen niet mee

In de browser staat deze kamer op de plek van de jaren '70, rug aan rug met de jaren '80 (main.js); hier
blijft alles op zijn plek in room.blend.

Gebruik:
  blender -b ~/Downloads/room.blend --python blender/build_room90.py -- <projectmap> [samples] [resolutie] [GPU|CPU]
"""
import bpy, sys, math, os
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
ROOT = args[0]
SAMPLES = int(args[1]) if len(args) > 1 else 512
SIZE = int(args[2]) if len(args) > 2 else 4096
DEVICE = args[3].upper() if len(args) > 3 else 'GPU'
SCALE = 0.5
ROOM = 'd90_diorama'
GLASS = set()

scene = bpy.context.scene

from mathutils import Matrix, Vector

# ---------- 1. alleen het diorama van de jaren '90 ----------
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
    # de PlayStation en de controller: je zet ze in het kastje, dus ze mogen geen schaduw op de vloer of het tapijt
    # bakken (anders bleef er een donkere rand achter waar ze lagen), net als de cassettes en kaders van de jaren '80
    inside = inside or o.name.startswith(('d90_los_', 'd90_spelconsole', 'd90_console', 'd90_gamepad'))
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
# de Memphis-vormen op de poster zijn weg: daar komt in de site een shader (shaders/rug.js). Ze mogen ook geen
# schaduw meer op het papier bakken.
for o in [o for o in O if o.name.startswith('d90_memphis')]:
    bpy.data.objects.remove(o, do_unlink=True)
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
    # en de takken van de ficus (13.000 driehoeken per tak): anders slokken ze de lightmap en de GLB op
    if (tris > 30000 and max(o.dimensions) < 0.3) or (tris > 6000 and max(o.dimensions) < 0.8):
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
def keep_object_coords(o, sc):
    """Materialen met objectcoördinaten (de sponstechniek op de muur, het laminaat, het tapijt) leggen hun patroon
    in de ruimte van het object. Zet je de schaal in de mesh, dan wordt dat patroon even veel keer fijner: de
    muur werd kurk. Een eigen kopie van het materiaal deelt de objectcoördinaten terug door de oude schaal."""
    for slot in o.material_slots:
        m = slot.material
        if not (m and m.use_nodes):
            continue
        outs = [(n, out) for n in m.node_tree.nodes if n.type == 'TEX_COORD' for out in n.outputs if out.name == 'Object' and out.links]
        if not outs:
            continue
        m = slot.material = m.copy()
        nt = m.node_tree
        for n in [n for n in nt.nodes if n.type == 'TEX_COORD']:
            out = n.outputs['Object']
            if not out.links:
                continue
            div = nt.nodes.new('ShaderNodeVectorMath')
            div.operation = 'DIVIDE'
            div.inputs[1].default_value = sc
            for link in list(out.links):
                nt.links.new(div.outputs[0], link.to_socket)
            nt.links.new(out, div.inputs[0])
        print('OBJECT COORDS', o.name, m.name, tuple(round(v, 3) for v in sc), flush=True)

for o in bake_objs:
    loc, rot, sc = _mw[o.name].decompose()
    if max(abs(sc.x - 1), abs(sc.y - 1), abs(sc.z - 1)) > 1e-4:
        keep_object_coords(o, sc)
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
    if o.name.startswith('d90_') and flat and n.length and (o.matrix_world.to_3x3() @ n).normalized().y > 0.5:
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


# in de edit-modus verborgen vlakken (742 in de Trinitron) worden wel gerenderd, maar Smart UV Project slaat ze
# over: ze hielden hun oude UV en lagen als stippen over de hele lightmap, bovenop de muur en de vloer
for o in bake_objs:
    for elems in (o.data.vertices, o.data.edges, o.data.polygons):
        elems.foreach_set('hide', [False] * len(elems))
# De bladeren van de ficus en de onderdelen van de echte VHS-cassettes zijn duizenden piepkleine eilandjes: samen
# met de rest ingepakt namen ze het grootste deel van de lightmap in, en kregen de muur, de vloer en de bank maar
# een hoekje (elke pixel ruis werd een zichtbaar bolletje). Ze krijgen nu samen een eigen hoekje van 5%; al de
# rest krijgt de overige 95%.
import re
DETAIL = re.compile(r'^(Plane\.\d+|hlina|kvetinac|vhs_)')
detail = [o for o in bake_objs if DETAIL.match(o.name)]
main_objs = [o for o in bake_objs if o not in detail]
print('LIGHTMAP', len(main_objs), 'objecten,', len(detail), 'details in een hoekje', flush=True)

def unwrap_lightmap(objs, scale, offset):
    if not objs:
        return
    select(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.003, rotate=True, scale=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        lm = o.data.uv_layers['Lightmap'].data
        uv = np.empty(len(lm) * 2, dtype=np.float32)
        lm.foreach_get('uv', uv)
        lm.foreach_set('uv', uv * scale + offset)

unwrap_lightmap(main_objs, 0.95, 0.0)
unwrap_lightmap(detail, 0.045, 0.953)
if os.environ.get('UV_CHECK'):  # enkel om te controleren: welke objecten kregen geen eigen lightmap-uitvouw?
    for o in bake_objs:
        me = o.data
        a_, b_ = me.uv_layers['UVMap'].data, me.uv_layers['Lightmap'].data
        same = all((a_[i].uv - b_[i].uv).length < 1e-6 for i in range(0, len(a_), max(1, len(a_) // 200)))
        hidden = sum(p.hide for p in me.polygons)
        if same or hidden:
            print('UVCHECK', o.name, 'same' if same else '', 'hidden', hidden, flush=True)
    print('UVCHECK DONE', flush=True)
    sys.exit(0)

# ---------- 3. baken ----------
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
if DEVICE == 'GPU':
    # de snelste GPU die er is: OptiX (NVIDIA RTX, bv. een 4080 op Windows), anders CUDA/HIP/oneAPI, op een Mac Metal
    for kind in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue  # bestaat niet op dit systeem
        prefs.refresh_devices()
        if any(d.type == kind for d in prefs.devices):
            break
    for d in prefs.devices:
        d.use = d.type == prefs.compute_device_type  # enkel de GPU('s) van dat type: de CPU erbij vertraagt eerder
    print('DEVICE', prefs.compute_device_type, [d.name for d in prefs.devices if d.use], flush=True)
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
SKY = None  # geen raam, geen lucht
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
    extent = max(max(o.dimensions) for o, _ in faces)
    small = extent < 0.15
    size = min(2048, src, 512 if small else 2048)
    # getegeld over het object (objectcoördinaten, een mapping die herhaalt) of procedureel: de texture herhaalt
    # zich over de muur of de vloer, dus de bake krijgt een resolutie naar de echte grootte (± 1024 px per meter)
    tiled = any(n.type == 'TEX_COORD' and any(o.links for o in n.outputs if o.name in ('Object', 'Generated')) for n in nodes) \
        or any(n.type == 'MAPPING' and max(abs(v) for v in n.inputs['Scale'].default_value) != 1 for n in nodes) \
        or any(n.type in ('TEX_NOISE', 'TEX_WAVE', 'TEX_VORONOI', 'TEX_BRICK', 'TEX_CHECKER', 'TEX_MAGIC') for n in nodes)
    if tiled and not small:
        size = max(size, min(4096, 1 << math.ceil(math.log2(max(1, 1024 * extent)))))
    # hangt de kleur niet van de UV af (enkel objectcoördinaten of procedureel), dan zegt de eigen UV niets: bij de
    # muur lag haar hele voorkant op een smal reepje en werd de sponstechniek strepen. Dan een nieuwe uitvouw.
    uv_driven = any(n.type == 'UVMAP' for n in nodes) \
        or any(n.type == 'TEX_COORD' and n.outputs['UV'].links for n in nodes) \
        or any(n.type == 'TEX_IMAGE' and not n.inputs['Vector'].links for n in nodes)
    if tiled and not uv_driven:
        redo = 'unwrap'
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
# het grote licht, zoals in de andere kamers: een plafondlicht boven het midden van het diorama (in room.blend gaf
# bijna enkel de halogeen licht; zonder die lamp bleef de kamer donker). Het hoort bij de lichtschakelaar.
if 'd90_licht_groot' not in O:
    floor = O['d90_vloer']
    fc = sum((floor.matrix_world @ Vector(c) for c in floor.bound_box), Vector()) / 8
    ld = bpy.data.lights.new('d90_licht_groot', 'AREA')
    ld.shape, ld.size, ld.size_y = 'RECTANGLE', 2.4, 1.6
    ld.energy = 260
    ld.color = (1.0, 0.93, 0.84)  # warm wit
    big = bpy.data.objects.new('d90_licht_groot', ld)
    big.location = (fc.x, fc.y - 0.1, 2.75)  # recht naar beneden, net boven de muur
    scene.collection.objects.link(big)
    print('BIG LIGHT', tuple(round(v, 2) for v in big.location), flush=True)
# geen raam: de tweede lichtlaag is hier de halogeen-uplighter (met zijn kaatsing op het plafond en zijn gloeiende kom)
DAY_LIGHTS = [O[n] for n in ('d90_licht_halogeen', 'd90_licht_plafond_terugkaats') if n in O]
OTHER_LIGHTS = [o for o in O if o.type == 'LIGHT' and o not in DAY_LIGHTS]
DAY_MATS = {m.name for m in bpy.data.materials if m.name.startswith('Mat_d90_halogeen_gloed')}
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


# Cycles ontruist een bake niet (de denoiser werkt enkel bij renders): met weinig samples bleven er korrelige
# vlekjes in de donkere hoeken (achter de bank, onder de lamp). Licht verloopt geleidelijk, dus de lightmap wordt
# zacht uitgefilterd: drie keer een boxfilter (≈ gauss), enkel binnen de eilanden van de lightmap (wat er rond
# een eiland niet gebakken is, telt niet mee), zodat er niets van een ander eiland of het zwart ertussen in loopt.
DENOISE_R = 3  # px per doorgang (bij 4096 px)

def _box(a, r, axis):
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)

def denoise(rgb):
    img = rgb.reshape(SIZE, SIZE, 3)
    mask = (img.max(axis=2) > 0).astype(np.float32)[..., None]
    num, den = img * mask, mask
    for _ in range(3):
        for axis in (0, 1):
            num, den = _box(num, DENOISE_R, axis), _box(den, DENOISE_R, axis)
    out = np.where(mask > 0, num / np.maximum(den, 1e-6), img)
    return out.reshape(-1, 3)


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
    rgb = px.reshape(-1, 4)[:, :3]
    if kind == 'LIGHT':
        rgb = denoise(rgb)
    rgb = np.clip(rgb * SCALE, 0, 1)
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
set_layer(True)
bake('baked90_lamp')
for sock, value, _ in emitters:  # de emissie met alles aan: ook de kom van de lamp (in three dimt die mee met de knop)
    sock.default_value = value
bake('baked90_emit', 'EMIT')
set_layer(False)
bake('baked90')

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
    filepath=f'{ROOT}/public/models/kamer90.glb', export_format='GLB',
    export_lights=False, export_cameras=False, export_apply=True, export_yup=True, export_normals=False,
    export_image_format='WEBP', export_image_quality=88, export_texcoords=True, export_animations=False,
)
print('EXPORT DONE', flush=True)
