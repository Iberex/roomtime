#!/bin/sh
# Bakt de jaren '90 op de vaste pc (RTX 4080, OptiX) en haalt het resultaat terug in public/.
#  - het Blender-bestand staat op de pc: C:\kamer70\room.blend (daar modelleer je)
#  - de log komt hier in blender/bake90.log, dus bake-status.html werkt gewoon (python3 blender/bake_status.py)
#  - de verbinding: ssh-sleutel ~/.ssh/kamer70_pc, host 'kamer70-pc' in ~/.ssh/config
#
# Gebruik:  sh blender/bake_on_pc.sh [samples=256] [resolutie=4096]
#           NOFETCH=1 sh blender/bake_on_pc.sh 16 1024    (enkel testen: niets terughalen)
set -e
cd "$(dirname "$0")/.."
SAMPLES=${1:-256}
SIZE=${2:-4096}
PC=kamer70-pc

scp -q blender/build_room90.py blender/bake90.bat "$PC:C:/kamer70/"
echo "bake gestart op de pc ($SAMPLES samples, $SIZE px) — log in blender/bake90.log"
ssh "$PC" "C:\\kamer70\\bake90.bat $SAMPLES $SIZE" > blender/bake90.log 2>&1 || true
if ! grep -q "EXPORT DONE" blender/bake90.log; then
  echo "de bake is niet goed geëindigd: zie blender/bake90.log"
  exit 1
fi
if [ -n "$NOFETCH" ]; then echo "klaar (NOFETCH: niets teruggehaald)"; exit 0; fi
scp -q "$PC:C:/kamer70/out/public/models/kamer90.glb" public/models/
for f in baked90 baked90_lamp baked90_emit; do
  scp -q "$PC:C:/kamer70/out/public/textures/$f.webp" public/textures/
done
echo "klaar: public/models/kamer90.glb en public/textures/baked90*.webp bijgewerkt"
