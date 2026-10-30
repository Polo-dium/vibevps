# Avatars Rocketbox → GLB

Avatars réalistes des passants et des PNJ (`client/src/world/avatars.js`),
tirés de la [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox)
(licence MIT, voir `client/public/avatars/LICENSE-rocketbox.md`).

1. `ROOT=$(pwd) bash tools/rocketbox/download.sh` : FBX + textures 512 px
   (PNG) dans `client/public/_pv/rb/<Nom>/` (+ animations dans `anim/`, voir
   les `curl` du README d'origine : `*_idle_neutral_01`, `*_walk_neutral_01`,
   `*_gestic_talk_neutral_01`). Dossier de travail : ne pas versionner.
2. Copier `_pv.js` dans `client/src/` (le temps de la conversion) et lancer
   `npm run dev`.
3. `node tools/rocketbox/convert.cjs ANIM_Female_Adult_01,ANIM_Male_Adult_01,Female_Adult_01,…`
   (Playwright ; three du projet : FBXLoader → soudure des sommets, un groupe
   par matériau, matériaux standard, textures JPEG/PNG → GLTFExporter).
   `ANIM_<Nom>` écrit `anim_f.glb` / `anim_m.glb` : squelette seul + clips
   `idle`, `walk` (sur place), `talk`, 15 images/s, rotations + position du
   bassin seulement.
4. Retirer `client/src/_pv.js` et `client/public/_pv/`.
