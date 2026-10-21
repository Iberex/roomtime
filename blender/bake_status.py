"""
Volgt een lopende bake van de jaren '90 (build_room90.py) en schrijft elke paar seconden bake-status.json in de
projectmap, voor bake-status.html (http://localhost:5192/bake-status.html op de dev-server).

Cycles toont tijdens het bakken geen voortgang, maar de fases staan in de log (blender/bake90.log) en hun
uitvoerbestanden krijgen een tijdstempel. De duur van een fase die nog loopt, wordt geschat uit eerdere bakes.

Gebruik:  python3 blender/bake_status.py            (stopt vanzelf als de bake klaar is)
          werkt ook voor een bake op de vaste pc (blender/bake_on_pc.sh): de log komt dan via ssh hier binnen
"""
import json, os, re, subprocess, time
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(ROOT, 'blender', 'bake90.log')
OUT = os.path.join(ROOT, 'bake-status.json')
TEX = os.path.join(ROOT, 'public', 'textures')

# fase, herkenning in de log, uitvoerbestand (voor het tijdstip), geschatte duur in minuten bij 256 samples
STAGES = [
    ('Kleurtextures per materiaal', r'ALBEDO BAKED', None, 12),
    ('Lamplaag (staande lamp)', r'BAKED .*baked90_lamp\.webp', 'baked90_lamp.webp', 44),
    ('Emissie (wat zelf licht geeft)', r'BAKED .*baked90_emit\.webp', 'baked90_emit.webp', 34),
    ('Kamerlaag (het grote licht)', r'BAKED .*baked90\.webp', 'baked90.webp', 44),
    ('Export naar kamer90.glb', r'EXPORT DONE', None, 3),
]
# op de vaste pc (RTX 4080, bake_on_pc.sh) gemeten: ruim twee keer zo snel als op de Mac
PC_MINUTES = [3, 13, 9, 12, 2]


def bake_pid():
    # hier (blender ... build_room90.py) of op de vaste pc (ssh ... bake90.bat, zie bake_on_pc.sh)
    r = subprocess.run(['pgrep', '-f', 'build_room90|bake90.bat'], capture_output=True, text=True)
    pids = [p for p in r.stdout.split() if p.strip()]
    return pids[0] if pids else None


def on_pc(pid):
    r = subprocess.run(['ps', '-o', 'command=', '-p', pid], capture_output=True, text=True)
    return 'bake90.bat' in r.stdout


def started_at(pid):
    r = subprocess.run(['ps', '-o', 'lstart=', '-p', pid], capture_output=True, text=True)
    return datetime.strptime(r.stdout.strip(), '%a %b %d %H:%M:%S %Y').timestamp()


seen = {}  # fase -> tijdstip waarop ze klaar was
start = None
while True:
    pid = bake_pid()
    if pid and start is None:
        start = started_at(pid)
        if on_pc(pid):
            STAGES = [(n, p, o, m) for (n, p, o, _), m in zip(STAGES, PC_MINUTES)]
    log = open(LOG, errors='ignore').read() if os.path.exists(LOG) else ''
    now = time.time()
    stages, prev_end, current = [], start or now, None
    for name, pat, out, minutes in STAGES:
        done = re.search(pat, log) is not None
        if done and name not in seen:
            f = out and os.path.join(TEX, out)
            if f and os.path.exists(f) and os.path.getmtime(f) >= (start or 0):
                seen[name] = os.path.getmtime(f)
            else:  # geen eigen bestand (kleurtextures, export): de log werd toen het laatst beschreven
                seen[name] = min(now, os.path.getmtime(LOG))
        if not done and current is None:
            current = name
        stages.append({'name': name, 'done': done, 'minutes': minutes,
                       'endedAt': seen.get(name), 'startedAt': prev_end if (done or name == current) else None})
        if done:
            prev_end = seen[name]
    failed = 'Traceback' in log or (pid is None and current is not None)
    json.dump({'start': start, 'now': now, 'running': pid is not None, 'failed': failed, 'stages': stages},
              open(OUT + '.tmp', 'w'))
    os.replace(OUT + '.tmp', OUT)
    if pid is None:
        break
    time.sleep(5)
