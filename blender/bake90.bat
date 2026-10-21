@echo off
rem Bakt de jaren 90 (build_room90.py) met Blender op deze pc. Gestart vanaf de Mac door blender/bake_on_pc.sh.
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b C:\kamer70\room.blend --python C:\kamer70\build_room90.py -- C:\kamer70\out %1 %2 GPU
