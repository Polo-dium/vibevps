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
  - VRAI RELIEF : `tools/relief.mjs` (appelé par fetch-osm, ou seul sur un
    JSON existant) lit les tuiles d'altitude Terrarium (AWS Open Data,
    décodeur PNG maison) → `data.relief` (grille Uint16 base64, hauteurs
    déjà × H_SCALE, ville plate ramenée à 0). Côté client `makeReliefFn` le
    remplace aux ellipsoïdes `data.hills` (repli), les collines descendent
    en pente continue vers l'eau (`waterDistanceFn`), les rues sont
    redécoupées tous les 6 m sur les pentes, les balmes se boisent
    (`buildGreenery`, rand dédié). JSON `version: 3` = relief.
  - `src/world/pentes.js` (vrai relief) : escaliers de pierre drapés sur la
    pente pour chaque `highway=steps` OSM (`data.steps` : p, w, n, inc ;
    repli : voies piétonnes à plus de 18 %), jardin en terrasses et balcon-
    panorama de la montée de la Grande-Côte (`planGrandeCote`, emprise
    réservée avant les bâtiments), murs de soutènement le long des rues
    taillées dans les pentes en ville. Marches et terrasses deviennent le
    sol (`ctx.terrainHeight`, index spatial), `ctx.pentesCovers` écarte les
    arbres.
  - `src/world/jardins.js` (vrai relief) : jardins clos des collines
    (Saint-Just, Fourvière, Croix-Rousse…). Grille d'occupation à 2 m
    (bâti + rues), `ctx.gardenAt` mémoïsé ; clôtures le long des rues côté
    jardin (mur de pierre dorée, muret + haie, haie ; portails), arbustes
    et cyprès instanciés (plafonds, cœur de ville d'abord), sol des
    jardins repeint en pelouses sur `ctx.terrainMesh`. `buildGreenery`
    plante les arbres plus serré dans les jardins. `seasons.js` respecte
    `material.userData.noSeason` aussi pour les couleurs d'instance.
  - `src/render/` — rendu « ciné » au palier Élevé (`post.js` : bloom HDR,
    étalonnage, MSAA), reflets d'environnement procéduraux (`envmap.js`),
    matériaux PBR et profils extrudés (`materials.js`), passe matière sur le
    décor (`enhance.js` : normal/rugosité dérivées des textures + texture de
    détail en coordonnées monde, palier Élevé). `detail.js` : finesse du
    décor (persos PBR, houppiers, corniches) réservée au palier Élevé.
    `ao.js` : occlusion ambiante écran à demi-résolution (rendu ciné,
    coupée en premier par la résolution dynamique). `atmosphere.js` : halo
    du soleil dans la brume (patch global des chunks fog, tous paliers).
    `landmarkFog(mesh, k)` : perspective aérienne des grands repères (Crayon,
    basilique, tour métallique, monuments) — profondeur de brume × k, jamais
    masqués par la portée de vue. Portée adaptative bornée par
    `preset.viewFloor` (quality.js). Alpes (`buildAlps`) : trois plans de
    crêtes fractales dans une texture de DONNÉES (neige, versant, plan),
    couleurs calculées dans le shader depuis la couleur de la brume
    (jour : roche bleutée et neige ; nuit : silhouette au clair de lune).
    `buildOsmBuildings` saute les empreintes de moins de 1,6 m de large
    (ou 3 m posées sur une rue) : murs/auvents tagués building dans OSM.
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
  - `src/world/squares.js` : grandes places dallées à leur vraie position GPS
    (`lyonXZ(lat, lon)` = même projection que `tools/fetch-osm.mjs`),
    fontaines (Bartholdi aux Terreaux, Jacobins, Saint-Jean), tour
    métallique de Fourvière. `streetsigns.js` : plaques de rue émaillées
    pour les grandes rues reconnues à leur tracé réel (jamais de faux nom).
    `parked.js` : voitures garées en créneau (InstancedMesh par quartier).
  - `src/world/monuments.js` : cathédrale Saint-Jean, Saint-Nizier, Hôtel de
    Ville, Opéra (voûte rouge la nuit), Palais de Justice (24 colonnes),
    dôme de l'Hôtel-Dieu. Empreinte OSM
    repérée par un point GPS, marquée `b.monument` (sautée par
    `buildOsmBuildings` APRÈS ses rand()), profil rebâti dans un repère
    orienté sur les murs (`Kit` : géométrie fusionnée par matériau,
    colliders en cellules). La place Saint-Jean se recale devant la façade
    (`ctx.placeOverrides`).
  - `src/world/passerelles.js` : passerelles piétonnes de la Saône (Palais de
    Justice haubanée, Saint-Georges et Saint-Vincent suspendues), absentes
    des rues OSM. Traversée au plus court mesurée sur `ctx.waterMask` autour
    d'un point GPS, tablier bombé praticable, escaliers sur les quais.
    Réutilise le `Kit` exporté par `monuments.js`.
  - `src/world/funicular.js` : la ficelle Saint-Jean → Fourvière (ville OSM)
    à travers le parc du Rosaire, deux cabines contrepoids calées sur
    `Date.now()` (même horaire chez tous), embarquement par E à quai. Le
    couloir (`ctx.ficelle`) est réservé avant la plantation des arbres.
  - `src/world/bridge.js` : ponts de pierre de la ville OSM (arches
    surbaissées, piles à becs, balustres instanciés au palier Élevé,
    dos d'âne `hump`, lampadaires versés dans `buildLamps` via
    `ctx.bridgeLamps`). `realBridges.js` les pose sur les VRAIS
    franchissements : `data.bridges` (ways bridge=* exportées par
    `tools/fetch-osm.mjs` : kind road|foot, n = nom, s = structure) + rues
    qui coupent l'eau (anciens JSON). Le tablier devient `ctx.terrainHeight`,
    `ctx.onBridge` masque le ruban de rue sur l'eau ; plus de ponts
    génériques à z fixes. Les passerelles OSM (kind foot) passent par
    `passerelles.js` (style d'après le nom ou la structure).
  - `src/world/berges.js` : péniches amarrées du quai Augagneur (rive gauche
    du Rhône), alignées sur le vrai bord de l'eau (polygones OSM, pas le
    masque à 4 m), 3 modèles en InstancedMesh, passerelles et bollards,
    guirlandes en points additifs allumées la nuit.
    Bas-ports de la rive gauche (`buildBasPorts`) : promenade basse au ras
    de l'eau (piste + pelouse + platanes) posée sur les premiers mètres du
    lit, praticable via `ctx.terrainHeight` / `ctx.basPortAt`.
  - Eau (`render/water.js`) : rides dans le sens du courant, écume au pied
    des quais et sillages des piles (`setShoreMap`, texture de distance à
    la rive cuite par `bakeShoreMap`, piles dans `ctx.bridgePiers`).
  - Ciel (`sky.js`) : 42 cumulus peints, seed fixe et dérive sur
    `Date.now()` (même ciel pour tous).
  - Quais de Saône : `bouquinistes.js` (boîtes vertes du quai de la Pêcherie,
    ouvertes le jour). Rues : `cyclistes.js` (Vélo'v recyclés autour du
    joueur, comme `passersby.js`). Devantures en volume : `buildShopVolumes`
    (stores bannes rayés, enseignes en drapeau lumineuses la nuit ; côté
    fragment, la couleur d'instance est sous `USE_COLOR`).
  - `marches.js` : marchés du quai Saint-Antoine et du boulevard de la
    Croix-Rousse (étals instanciés, remballés la nuit). `traboules.js` :
    traboules VISITABLES (longue traboule/Tour Rose, cour des Voraces) bâties
    dans des POCHES hors carte sous le sol (`makePocket` : `ctx.pockets`,
    `ctx.terrainHeight` y renvoie le plancher, `ctx.inPocket`) ; portes aux
    vraies adresses, sortie par déclencheur au bout du couloir. `cafes.js` :
    salle de bouchon partagée (poche) ouverte depuis 5 devantures café.
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
- `server/` — Express + ws + better-sqlite3. `env.js` charge `.env` (racine)
  au démarrage. `ai.js` : client Anthropic partagé + bornes (Sonnet).
  `npcTalk.js` : dialogues libres des PNJ (Claude Haiku, personas `patron`,
  `patronne`, `marchand`, `bouquiniste`, historique serveur 15 min, quotas
  joueur + `NPC_DAILY_CAP`) → `POST /api/npc/talk`. `tts.js` : voix Piper
  (une voix par persona, `GET /api/tts/:id` seulement pour les répliques
  émises par le serveur, cache WAV dans `server/data/tts-cache`), installé
  en tâche de fond par `tools/install-piper.mjs`. `stt.js` : micro → texte
  (whisper.cpp compilé par `tools/install-whisper.mjs`, `POST /api/stt` en
  WAV 16 kHz mono brut, prompt de vocabulaire lyonnais, une transcription à
  la fois, hallucinations « sous-titres » filtrées). Client : `ui/talk.js`
  (`ctx.talkTo(id, { title, emoji, greet, fallback })`, bouton 🎤 / Tab :
  MediaRecorder → OfflineAudioContext 16 kHz → WAV ; → false si l'IA est
  coupée, le PNJ garde alors ses répliques fixes). `ws.js` : positions 15 Hz, PvP
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
