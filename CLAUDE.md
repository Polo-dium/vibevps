# CLAUDE.md — VibeVPS / Lyon Arcade

Jeu 3D multijoueur dans le navigateur : un Lyon low-poly (Bellecour, Fourvière,
le Crayon, Rhône/Saône) avec salle d'arcade, tir PvP/PNJ, graffiti et
progression. Tout le code, les commentaires et l'UI sont **en français**.

## Déploiement — IMPORTANT

- **La branche de production est `claude/3d-arcade-map-vps-5v3opg`.**
  Le VPS exécute un cron qui vérifie **toutes les minutes** si cette branche a
  bougé, puis met à jour tout seul (pull + build + restart).
- Pour livrer : développer sur ta branche de travail, puis **fusionner dans
  `claude/3d-arcade-map-vps-5v3opg`** et pousser. Ne jamais compter sur un
  simple push de branche de travail pour déployer.
- `client/dist/` est gitignoré : le build de prod se fait sur le VPS.
  Le serveur sert `client/dist` s'il existe (voir `server/src/index.js`).
- Les migrations SQLite s'appliquent au démarrage du serveur
  (`server/src/db.js`, `ALTER TABLE` dans des try/catch).

## Commandes

```bash
npm install        # racine + workspaces client/serveur
npm run dev        # serveur (3000, API+WS) + client Vite (5173) en parallèle
npm run build      # compile le client dans client/dist
npm start          # serveur de prod (sert client/dist)
```

## Architecture

- `client/` — Three.js 0.172 + Vite, **zéro asset externe** : géométrie en
  primitives, textures en canvas procédural, audio 100 % WebAudio + synthèse
  vocale. Ça doit rester ainsi (poids ~180 kB gzip).
  EXCEPTION validée par Polo (28/10/2026) : la chanteuse du concert peut
  être un modèle .glb (image → 3D, brief Grok dans le Drive
  `CallMeIt_rushs/Chanteuse_3D/`), chargé à l'approche du théâtre. Les
  musiques et clips de l'album sont aussi des fichiers (`public/music`,
  `public/clips`).
  - `src/world/` — ville procédurale (`city.js`), vrai Lyon OSM optionnel
    (`cityReal.js`, activé si `client/public/lyon-osm.json` existe, généré par
    `tools/fetch-osm.mjs`), ciel (`sky.js`), PNJ (`npcs.js`).
  - `src/render/` — rendu « ciné » au palier Élevé (`post.js` : bloom HDR,
    étalonnage, MSAA), reflets d'environnement procéduraux (`envmap.js`),
    matériaux PBR et profils extrudés (`materials.js`), passe matière sur le
    décor (`enhance.js` : normal/rugosité dérivées des textures + texture de
    détail en coordonnées monde, palier Élevé). `detail.js` : finesse du
    décor (persos PBR, houppiers, corniches) réservée au palier Élevé.
    `ao.js` : occlusion ambiante écran à demi-résolution (rendu ciné,
    coupée en premier par la résolution dynamique). `atmosphere.js` : halo
    du soleil dans la brume (patch global des chunks fog, tous paliers).
    `sculpt.js` : modelage organique par champs de distance (union douce
    de volumes → maillage « surface nets » au chargement, mis en cache et
    partagé) — à utiliser pour tout personnage/statue/créature au lieu
    d'empiler des primitives.
  - `src/render/facade.js` : patch de shader des murs OSM — chaque fenêtre
    de la cellule répétée se décline (vitres en retrait par parallaxe,
    persiennes, voilages, balcons filants ; rez-de-chaussée v ∈ [0;1[ à
    bossages avec portes cochères et fenêtres à barreaux ; u < 0 = mur
    aveugle). Les étages se comptent depuis le trottoir (yBase), pas depuis
    la jupe enterrée.
    hasard tiré de floor(uv) + teinte de l'immeuble. `enhance.js` reprend
    `material.userData.shaderPatch` au palier Élevé.
  - `src/render/road.js` : chaussée et pavés qui se mouillent après l'averse
    partagée (`rainAmount`), flaques le long des caniveaux (miroirs au palier
    Élevé, reflets rasants assombris = façades d'en face).
  - `src/world/pigeons.js` : pigeons sculptés en InstancedMesh (corps + 2
    ailes = 3 draw calls), deux volées recyclées vers les coins proches du
    joueur (places, terrasses), envol si on approche (`ctx.scareBirds`).
  - `src/world/bridge.js` : ponts de pierre de la ville OSM (arches
    surbaissées, piles à becs, balustres instanciés au palier Élevé,
    lampadaires versés dans `buildLamps` via `ctx.bridgeLamps`).
  - `src/world/terraces.js` : terrasses de café devant les devantures
    « café »/« bouchon » (mobilier instancié par quartier, clients assis
    recyclés autour du joueur — `buildHuman({ seated: true })` ajoute des
    genoux). `roofs.js` : lucarnes et souches de cheminée en volume
    (InstancedMesh par tuile de ville).
  - `src/world/human.js` (humains sculptés, 7 meshes/humain (coudes articulés), géométrie
    partagée, couleurs par sommet) et `src/world/statue.js` (Louis XIV,
    Saint-Exupéry et le Petit Prince).
  - Théâtre gallo-romain de Fourvière (ville OSM) : `theatre.js` (gradins
    praticables — `ctx.terrainHeight` réécrit dans l'emprise,
    `ctx.terrainMeshHeight` garde le maillage du sol sous la pierre),
    `concert.js` (concert permanent : morceau du jour + position de lecture
    déduits de `Date.now()`, son spatial chargé à l'approche, écran géant en
    gros plan via un calque de caméra, faisceaux additifs), `singer.js`
    (la chanteuse des clips : modèle .glb riggé + os de mâchoire ajouté au
    chargement pour chanter, repli sculpté), `album.js` (titres, paroles par
    section). Ajouter un morceau : MP3 dans `client/public/music/` + une
    entrée dans `album.js`.
  - `src/player/` — contrôles FPS + tactile, arme (modèles détaillés dans
    `weaponModels.js`), joueurs distants, voix.
  - `src/games/` — bornes d'arcade : mini-jeux HTML autonomes en iframe
    sandbox (`builtin/`), pont clavier par postMessage (`shell.js`).
  - `src/tags/` — bombe de peinture, décals réseau, éditeur de tags.
  - `src/progress.js` — niveaux (`levelOf`) et définitions des succès.
- `server/` — Express + ws + better-sqlite3. `ws.js` : positions 15 Hz, PvP
  autoritatif (dégâts/kills/regen), chat de proximité. `api.js` : REST
  (register, tags, scores, progression, génération de bornes par IA si
  `ANTHROPIC_API_KEY`).

## Règles du projet

- **Perf mobile d'abord** : pas de vraie lumière dynamique ajoutée (utiliser
  des sprites additifs pour les lueurs), matériaux/géométries partagés,
  particules plafonnées, InstancedMesh pour tout ce qui se répète.
- **Monde déterministe** : la ville est générée avec un seed fixe
  (`makeRand`) pour que les tags tombent sur les mêmes murs chez tout le
  monde. Ne pas introduire de `Math.random()` dans le placement du décor
  persistant.
- **Événements partagés sans serveur** : le cycle jour/nuit (10 min) et le
  silure géant (toutes les 4 min) sont calés sur `Date.now()` — même horloge
  pour tous les joueurs, aucun trafic réseau. Réutiliser ce motif.
- Textures canvas couleur : penser `tex.colorSpace = THREE.SRGBColorSpace`.
- Le protocole WS est minimaliste (`t: 's'|'shot'|'hit'|'chat'|…`) : rester
  rétro-compatible, préférer des champs optionnels aux changements de format.
- Identité du jeu : « Lyon délirant en low-poly » — humour lyonnais (gones,
  fenottes, Guignol, quenelle), couleurs néon arcade, easter eggs bienvenus.
