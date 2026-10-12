# Stride Room
Three.js + Vite static app. `npm i && npm run build` → `dist/` (base './', Pages-friendly). `?debug=1` or the button shows foot-contact markers (green = sole on floor).
Config constants at top of `src/main.js` (MODEL_URL, ANIM_SOURCE_URL, waypoints). Visible model: Michelle; walk/idle retargeted from Xbot.

## Characters (MPFB test)
Woman and Man are built with MakeHuman MPFB2 in Blender (Mixamo rig) from CC0 MakeHuman asset packs (system assets, skins, hair, clothes, shoes). Walk/idle are retargeted from Mixamo Xbot with A-pose→T-pose rest alignment. Textures capped at 1024px.
