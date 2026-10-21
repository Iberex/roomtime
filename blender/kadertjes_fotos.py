"""
Tekent de foto's voor de kaders aan de muur (blender/kadertjes/*.png): zelfgetekende "oude foto's" —
verbleekte kleuren, korrel, een vignet — zoals ze bij bomma aan de muur hangen.
  python3 blender/kadertjes_fotos.py
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageEnhance

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kadertjes')
os.makedirs(OUT, exist_ok=True)
random.seed(7)
S = 2  # supersampling

def canvas(w, h, top, bottom):
    im = Image.new('RGB', (w * S, h * S))
    d = ImageDraw.Draw(im)
    for y in range(h * S):
        t = y / (h * S - 1)
        d.line([(0, y), (w * S, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return im, ImageDraw.Draw(im)

def sc(v): return [(x * S, y * S) for x, y in v]

def ell(d, cx, cy, rx, ry, fill): d.ellipse([(cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S], fill=fill)
def rect(d, x0, y0, x1, y1, fill): d.rectangle([x0 * S, y0 * S, x1 * S, y1 * S], fill=fill)
def poly(d, pts, fill): d.polygon(sc(pts), fill=fill)

def person(d, cx, base, h, body, skin=(222, 178, 150), hair=(70, 48, 36), dress=False, bun=False, hat=None):
    head = h * 0.16
    top = base - h
    if dress:
        poly(d, [(cx - h * 0.08, top + head * 2.2), (cx + h * 0.08, top + head * 2.2), (cx + h * 0.22, base), (cx - h * 0.22, base)], body)
    else:
        rect(d, cx - h * 0.1, top + head * 2.2, cx + h * 0.1, base - h * 0.42, body)
        rect(d, cx - h * 0.095, base - h * 0.45, cx - h * 0.005, base, tuple(max(0, c - 25) for c in body))
        rect(d, cx + h * 0.005, base - h * 0.45, cx + h * 0.095, base, tuple(max(0, c - 25) for c in body))
    rect(d, cx - head * 0.28, top + head * 1.7, cx + head * 0.28, top + head * 2.3, skin)
    ell(d, cx, top + head, head * 0.78, head, skin)
    ell(d, cx, top + head * 0.55, head * 0.85, head * 0.62, hair)
    if bun: ell(d, cx, top - head * 0.15, head * 0.5, head * 0.45, hair)
    if hat: ell(d, cx, top + head * 0.2, head * 1.2, head * 0.28, hat); ell(d, cx, top, head * 0.65, head * 0.5, hat)
    rect(d, cx - head * 0.55, top + head * 0.9, cx - head * 0.2, top + head * 1.0, (40, 30, 30))  # ogen
    rect(d, cx + head * 0.2, top + head * 0.9, cx + head * 0.55, top + head * 1.0, (40, 30, 30))
    rect(d, cx - head * 0.2, top + head * 1.4, cx + head * 0.2, top + head * 1.45, (150, 70, 70))

def finish(im, name, tint=(1.04, 0.98, 0.9), fade=0.75, sepia=0.0, bw=False, border=False):
    w, h = im.size[0] // S, im.size[1] // S
    im = im.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.9))
    if bw:
        im = im.convert('L').convert('RGB')
    im = ImageEnhance.Color(im).enhance(0.75 if not bw else 1)
    r, g, b = im.split()
    im = Image.merge('RGB', (r.point(lambda v: min(255, int(v * tint[0]))), g.point(lambda v: min(255, int(v * tint[1]))), b.point(lambda v: min(255, int(v * tint[2])))))
    if sepia:
        gray = ImageEnhance.Contrast(im.convert('L')).enhance(1.1)
        sep = Image.merge('RGB', (gray.point(lambda v: min(255, int(v * 1.08 + 12))), gray.point(lambda v: int(v * 0.95 + 6)), gray.point(lambda v: int(v * 0.75))))
        im = Image.blend(im, sep, sepia)
    # verbleken: zwart wordt grijsbruin, wit wordt crème
    lo, hi = (38, 30, 26), (244, 238, 222)
    r, g, b = im.split()
    im = Image.merge('RGB', tuple(c.point(lambda v, l=l, hgh=hh: int(l + (hgh - l) * (v / 255) ** 1.05 * fade + (1 - fade) * (hgh - l) * 0.5 * 0)) for c, l, hh in zip((r, g, b), lo, hi)))
    # korrel
    noise = Image.effect_noise((w, h), 12).convert('RGB')
    im = ImageChops.add(im, ImageChops.subtract(noise, Image.new('RGB', (w, h), (128, 128, 128))), scale=1.0)
    # vignet
    vg = Image.new('L', (w, h), 255)
    ImageDraw.Draw(vg).ellipse([-w * 0.25, -h * 0.25, w * 1.25, h * 1.25], fill=0)
    vg = vg.filter(ImageFilter.GaussianBlur(min(w, h) * 0.18)).point(lambda v: int(v * 0.28))
    im = ImageChops.subtract(im, Image.merge('RGB', (vg, vg, vg)))
    if border:  # witte rand zoals een afdruk
        b = int(min(w, h) * 0.05)
        framed = Image.new('RGB', (w, h), (240, 234, 220))
        framed.paste(im.crop((b, b, w - b, h - b)), (b, b))
        im = framed
    im.save(os.path.join(OUT, name))
    print('foto', name, im.size)

# 1 — aan zee (liggend)
im, d = canvas(800, 600, (250, 190, 150), (255, 226, 190))
ell(d, 560, 250, 70, 70, (255, 236, 190))
rect(d, 0, 300, 800, 400, (92, 150, 170))
for y in range(305, 400, 12): rect(d, 0, y, 800, y + 2, (150, 196, 205))
poly(d, [(0, 400), (800, 400), (800, 600), (0, 600)], (228, 200, 150))
for x, c in ((120, (200, 60, 50)), (620, (60, 110, 180))):  # parasols
    rect(d, x - 2, 420, x + 2, 520, (90, 70, 50))
    poly(d, [(x - 80, 430), (x, 380), (x + 80, 430)], c)
    poly(d, [(x - 80, 430), (x - 27, 430), (x, 380)], (245, 240, 230))
    poly(d, [(x + 27, 430), (x + 80, 430), (x, 380)], (245, 240, 230))
person(d, 330, 545, 190, (200, 70, 80), dress=True, bun=False)
person(d, 400, 548, 130, (60, 100, 160))
person(d, 215, 520, 170, (230, 200, 90))
finish(im, 'foto_zee.png', tint=(1.05, 0.96, 0.9), border=True)

# 2 — portret (staand, sepia)
im, d = canvas(600, 800, (120, 100, 85), (70, 55, 45))
person(d, 300, 800, 700, (60, 50, 60), skin=(225, 190, 165), hair=(185, 180, 175), bun=True)
poly(d, [(215, 380), (300, 460), (385, 380), (385, 420), (300, 500), (215, 420)], (240, 235, 225))  # kraagje
ell(d, 300, 478, 11, 11, (225, 215, 190))  # broche
finish(im, 'foto_portret.png', sepia=0.85, fade=0.8)

# 3 — chalet (vierkant)
im, d = canvas(600, 600, (150, 195, 235), (205, 225, 240))
poly(d, [(0, 330), (150, 230), (280, 300), (420, 200), (600, 320), (600, 600), (0, 600)], (110, 140, 120))
poly(d, [(420, 200), (460, 240), (380, 240)], (240, 240, 245))
rect(d, 0, 380, 600, 600, (120, 170, 80))
rect(d, 190, 330, 410, 470, (170, 120, 80))
poly(d, [(170, 335), (300, 250), (430, 335)], (170, 60, 50))
rect(d, 280, 390, 330, 470, (80, 55, 40))
rect(d, 215, 360, 255, 400, (230, 215, 150)); rect(d, 345, 360, 385, 400, (230, 215, 150))
for x in (60, 500, 540):
    poly(d, [(x - 30, 440), (x, 330), (x + 30, 440)], (50, 100, 60)); rect(d, x - 4, 440, x + 4, 470, (80, 60, 40))
person(d, 130, 560, 180, (190, 60, 60), dress=True); person(d, 470, 560, 200, (60, 80, 120))
finish(im, 'foto_chalet.png', tint=(1.06, 0.97, 0.88), border=True)

# 4 — bruiloft (staand, zwart-wit)
im, d = canvas(600, 800, (190, 190, 190), (110, 110, 110))
ell(d, 300, 330, 230, 260, (230, 230, 230))
rect(d, 70, 330, 530, 800, (230, 230, 230))
ell(d, 300, 330, 190, 220, (90, 90, 90)); rect(d, 110, 330, 490, 800, (90, 90, 90))
person(d, 220, 790, 560, (35, 35, 40), skin=(210, 210, 210), hair=(60, 60, 60))
person(d, 380, 790, 520, (250, 250, 250), skin=(215, 215, 215), hair=(70, 70, 70), dress=True)
poly(d, [(330, 235), (430, 235), (470, 560), (300, 560)], (235, 235, 235))  # sluier
for i in range(12): ell(d, 150 + i * 28, 150 + 70 * math.sin(i / 11 * math.pi), 18, 14, (245, 245, 245))
finish(im, 'foto_bruiloft.png', bw=True, sepia=0.35, fade=0.82)

# 5 — bloemen (klein, staand)
im, d = canvas(600, 800, (205, 170, 120), (170, 125, 90))
for x in range(0, 600, 60): rect(d, x, 0, x + 28, 560, (195, 155, 105))      # behang
rect(d, 0, 560, 600, 800, (110, 75, 50))                                    # tafel
for ang, c in ((-30, (215, 70, 90)), (-8, (245, 200, 60)), (14, (225, 110, 160)), (34, (250, 245, 235)), (0, (215, 70, 90))):
    x = 300 + ang * 5.5; y = 270 + abs(ang) * 3
    d.line([(300 * S, 560 * S), (x * S, y * S)], fill=(60, 110, 60), width=5 * S)
    ell(d, x, y, 48, 44, c); ell(d, x, y, 17, 15, tuple(max(0, v - 70) for v in c))
poly(d, [(225, 480), (375, 480), (350, 640), (250, 640)], (70, 110, 150)); rect(d, 220, 470, 380, 490, (90, 135, 175))
finish(im, 'foto_bloemen.png', tint=(1.07, 0.97, 0.87), border=True)

# 6 — de bergen (liggend)
im, d = canvas(800, 600, (130, 170, 215), (225, 230, 235))
poly(d, [(0, 360), (160, 150), (260, 250), (420, 90), (600, 270), (720, 180), (800, 300), (800, 600), (0, 600)], (120, 130, 155))
poly(d, [(420, 90), (470, 170), (440, 150), (415, 190), (385, 150), (365, 170)], (245, 245, 250))
poly(d, [(160, 150), (195, 210), (160, 195), (130, 215)], (245, 245, 250))
rect(d, 0, 400, 800, 600, (95, 150, 110))
ell(d, 380, 470, 230, 50, (110, 160, 195))
for x in (40, 110, 700, 760, 650):
    poly(d, [(x - 35, 470), (x, 330), (x + 35, 470)], (45, 95, 60)); rect(d, x - 4, 470, x + 4, 500, (80, 60, 40))
ell(d, 560, 540, 40, 22, (240, 235, 225)); ell(d, 590, 525, 16, 14, (240, 235, 225)); rect(d, 535, 550, 541, 580, (230, 225, 215)); rect(d, 570, 550, 576, 580, (230, 225, 215))
for p in ((545, 520), (565, 515)): ell(d, p[0], p[1], 6, 6, (60, 50, 45))
finish(im, 'foto_bergen.png', tint=(1.03, 0.98, 0.92))
