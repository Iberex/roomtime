"""
Bouwt de web-assets uit room.blend:
  - houdt enkel het diorama (d70_*) + camera over
  - maakt een lightmap-UV en bakt het volledige beeld (kleur × licht + emissie) met Cycles
    -> elk Blender-materiaal, ook procedurele nodes, komt 1-op-1 op de site
  - exporteert public/models/kamer70.glb (geometrie, camera) en de bakes in public/textures/:
      baked.webp            kamer zonder de staande lamp      baked_lamp.webp      enkel de staande lamp
      baked_los.webp        losse objecten zonder de lamp     baked_los_lamp.webp  losse objecten, enkel de lamp
      baked_tv.webp         enkel het (witte) tv-scherm       baked_los_tv.webp    losse objecten, enkel de tv
    In three: kleur = basis × kamerlicht + lamp × lamplicht + tv × kleur van het beeld.
  - de losse objecten (afstandsbediening, stekkers) hebben een eigen lightmap en worden gebakken
    zonder dat ze schaduw op de kamer werpen: in de browser kun je ze verplaatsen.
  - de kabels worden niet gebakken: in de browser zijn het live touwen

Gebruik:
  blender -b ~/Downloads/room.blend --python blender/build_assets.py -- <projectmap> [samples] [resolutie]
"""
import bpy, sys, math, os
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
ROOT = args[0]
SAMPLES = int(args[1]) if len(args) > 1 else 768
SIZE = int(args[2]) if len(args) > 2 else 4096
SCALE = 0.5  # waarden tot 2.0 passen zo in een 8-bit texture; in three × 2

scene = bpy.context.scene

# ---------- 1. alleen het diorama ----------
# enkel d70_diorama en alles eronder: de kopie voor de jaren '80 (d70_diorama.001) heeft een eigen script
keep = {'Camera'}
def collect(o):
    keep.add(o.name)
    for c in o.children:
        collect(c)
collect(bpy.data.objects['d70_diorama'])
for o in list(bpy.data.objects):
    if o.name not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.outliner.orphans_purge(do_recursive=True)
O = bpy.data.objects

# ---------- 2. lightmap UV ----------
CABLES = {'d70_lamp_kabel', 'd70_tv_kabel'}
MOVABLE = {'d70_afstandsbediening', 'd70_afstandsbediening_toetsen', 'd70_lamp_stekker', 'd70_tv_stekker'}
bake_objs = [o for o in O if o.type == 'MESH' and o.name != 'd70_tv_scherm' and o.name not in CABLES]
static_objs = [o for o in bake_objs if o.name not in MOVABLE]
movable_objs = [o for o in bake_objs if o.name in MOVABLE]

# modifiers (bevel, subsurf) eerst toepassen: bake en export gebruiken dan exact dezelfde mesh
for o in bake_objs:
    if not o.modifiers:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    if o.data.users > 1:
        o.data = o.data.copy()
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
for o in bake_objs:
    me = o.data
    render_uv = next(l for l in me.uv_layers if l.active_render)
    if 'Lightmap' not in me.uv_layers:
        me.uv_layers.new(name='Lightmap')
    render_uv.active_render = True           # materialen blijven hun eigen UV gebruiken bij het baken
    me.uv_layers.active = me.uv_layers['Lightmap']


def select(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


# twee aparte lightmaps: de kamer en de losse objecten
for group in (static_objs, movable_objs):
    select(group)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.003, rotate=True, scale=True)
    bpy.ops.object.mode_set(mode='OBJECT')

# ---------- 3. baken ----------
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.refresh_devices()
for d in prefs.devices:
    d.use = True
scene.cycles.device = 'GPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_adaptive_sampling = False
scene.cycles.use_denoising = False

# het tv-scherm krijgt live de shader; zijn blauwe gloed hoort niet in de bake
scr = bpy.data.materials['Mat_d70_tv_scherm']
scr_bsdf = next(n for n in scr.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
scr_bsdf.inputs['Emission Strength'].default_value = 0.0

# lichtlagen: de staande lamp (lichten + gloeiende kap en peer) apart van de rest
LAMP_LIGHTS = [O['d70_licht_staanlamp'], O['d70_licht_staanlamp_punt']]
OTHER_LIGHTS = [o for o in O if o.type == 'LIGHT' and o not in LAMP_LIGHTS]
LAMP_MATS = {'Beige linen fabric', 'Mat_d70_peer'}
emitters = []  # (socket, oorspronkelijke sterkte, hoort bij de lamp)
for mat in {s.material for o in bake_objs for s in o.material_slots if s.material}:
    for n in mat.node_tree.nodes:
        sock = n.inputs.get('Emission Strength') if n.type == 'BSDF_PRINCIPLED' else n.inputs.get('Strength') if n.type == 'EMISSION' else None
        if sock is not None:
            emitters.append((sock, sock.default_value, mat.name in LAMP_MATS))
world_bg = next((n for n in scene.world.node_tree.nodes if n.type == 'BACKGROUND'), None) if scene.world else None
world_strength = world_bg.inputs['Strength'].default_value if world_bg else 0


TV_GLOW = 3.0  # sterkte van het witte tv-scherm in de tv-laag; in three × de kleur van het beeld


def set_layer(layer):
    """base: kamerlicht · lamp: enkel de staande lamp · tv: enkel het tv-scherm, wit"""
    lamp, tv = layer == 'lamp', layer == 'tv'
    for o in LAMP_LIGHTS:
        o.hide_render = not lamp
    for o in OTHER_LIGHTS:
        o.hide_render = layer != 'base'
    for sock, value, is_lamp in emitters:
        sock.default_value = value if (layer == 'base' and not is_lamp) or (lamp and is_lamp) else 0.0
    if world_bg:
        world_bg.inputs['Strength'].default_value = world_strength if layer == 'base' else 0.0
    scr_bsdf.inputs['Emission Color'].default_value = (1, 1, 1, 1)
    scr_bsdf.inputs['Emission Strength'].default_value = TV_GLOW if tv else 0.0


def bake(objs, size, name, samples, hide=()):
    scene.cycles.samples = samples
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    added = []
    for mat in {s.material for o in objs for s in o.material_slots if s.material}:
        nt = mat.node_tree
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        nt.nodes.active = n
        added.append((nt, n))
    for o in hide:
        o.hide_render = True
    select(objs)
    # alles behalve glans (die is kijkhoek-afhankelijk en komt live in three)
    bpy.ops.object.bake(
        type='COMBINED',
        pass_filter={'DIRECT', 'INDIRECT', 'DIFFUSE', 'TRANSMISSION', 'EMIT'},
        use_clear=True, margin=8,
    )
    for o in hide:
        o.hide_render = False
    for nt, n in added:
        nt.nodes.remove(n)

    # lineair -> × SCALE -> sRGB, opslaan als WebP
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = np.clip(px.reshape(-1, 4)[:, :3] * SCALE, 0, 1)
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    out = bpy.data.images.new(name + 'Out', size, size, alpha=False)
    out_px = np.ones((size * size, 4), dtype=np.float32)
    out_px[:, :3] = srgb
    out.pixels.foreach_set(out_px.ravel())
    os.makedirs(f'{ROOT}/public/textures', exist_ok=True)
    out.filepath_raw = f'{ROOT}/public/textures/{name}.webp'
    out.file_format = 'WEBP'
    scene.render.image_settings.quality = 92
    out.save()
    print('BAKED', out.filepath_raw, flush=True)


cables = [O[n] for n in CABLES if n in O]
for o in cables:
    o.hide_render = True  # worden live touwen in de browser
for layer, suffix in (('base', ''), ('lamp', '_lamp'), ('tv', '_tv')):
    set_layer(layer)
    # het zachte lamp- en tv-licht heeft minder resolutie nodig
    size = SIZE if layer == 'base' else SIZE // 2
    samples = SAMPLES
    # het lamplicht in donkere hoekjes (onder de tv) is bijna enkel indirect: uitschieters begrenzen
    scene.cycles.sample_clamp_indirect = 0.0 if layer == 'base' else 3.0
    # kamer: zonder de losse objecten, zodat er geen schaduw achterblijft als je ze verplaatst
    bake(static_objs, size, f'baked{suffix}', samples, hide=movable_objs)
    bake(movable_objs, 1024, f'baked_los{suffix}', samples)
for o in LAMP_LIGHTS + OTHER_LIGHTS:
    o.hide_render = False
for sock, value, _ in emitters:
    sock.default_value = value
if world_bg:
    world_bg.inputs['Strength'].default_value = world_strength

bpy.ops.wm.save_as_mainfile(filepath=f'{ROOT}/blender/kamer70_baked.blend', copy=True)

# ---------- 4. export: enkel geometrie + camera (kleur zit in de bake) ----------
# Alleen de lightmap-UV blijft over, zodat die bij elk object TEXCOORD_0 is.
for o in bake_objs:
    me = o.data
    for name in [l.name for l in me.uv_layers if l.name != 'Lightmap']:
        me.uv_layers.remove(me.uv_layers[name])  # op naam: verwijzingen worden ongeldig na remove()
    # losse 2D-attributen op de hoekpunten exporteert glTF ook als TEXCOORD
    for name in [a.name for a in me.attributes if a.domain == 'CORNER' and a.data_type == 'FLOAT2' and a.name != 'Lightmap']:
        me.attributes.remove(me.attributes[name])
    print('UVS', o.name, [l.name for l in me.uv_layers])

bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(
    filepath=f'{ROOT}/public/models/kamer70.glb', export_format='GLB',
    export_lights=False, export_cameras=True, export_apply=True, export_yup=True,
    export_image_format='NONE', export_texcoords=True, export_animations=False,
)
print('EXPORT DONE')
