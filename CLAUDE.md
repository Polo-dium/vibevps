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
- Un « go » de Polo vaut feu vert pour fusionner dans la branche de
  production et pousser (précisé le 10/11/2026) — pas besoin de redemander.
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
  `public/clips`). EXCEPTION validée par Polo (30/10/2026) : avatars
  réalistes Microsoft Rocketbox (MIT) dans `public/avatars` (~650 Ko
  chacun + `anim_f`/`anim_m` partagés), préparés par `tools/rocketbox/`.
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
  - Place Bellecour (ville OSM) : le gabarit `BELLECOUR_REAL` est RESSERRÉ au
    chargement sur le bord des vraies rues qui l'entourent (lancer de rayons
    dans le repère tourné, `cityReal.js`), pivot et angle inchangés
    (`ctx.belleRot.cx/cz` = pivot, ≠ centre du rectangle) — ne jamais
    supposer que le centre du rectangle est le pivot.
    `bakeSmallDecor(groupe)` (utils.js, appelé dans main.js après les
    saisons) fusionne le petit décor de la place (Lambert uni sans texture,
    sans nom ni userData) en 2 maillages : 92 draw calls → 2. Une pièce que
    le jeu doit retrouver ensuite doit donc porter un `name` ou un
    `userData`. Pelouse tondue en bandes et parterres à la française
    (`noSeason` : le gazon ne roussit pas). Globes de lampadaires : 80
    triangles à moins de 70 m, 20 au-delà (`?debug&nobake` pour comparer).
    Stand de tir et clos de pétanque suivent l'angle de la place :
    `rotatedCtx(ctx, cx, cz, yaw)` (utils.js) pivote maillages, colliders
    (murs longs découpés en cellules de ~1 m), interactions et POI d'un
    constructeur écrit en coordonnées droites (`RANGE.rot`).
    `petanque.js` : mène en tête-à-tête contre Dédé (3 boules chacun, le
    joueur lance le cochonnet, l'équipe qui n'a pas le point rejoue, chocs
    entre boules, premier à 13) ; Dédé choisit sa force en simulant le lancer.
  - Impacts de balles : `snapToWall` (main.js) recale le point sur le vrai
    tracé des façades (`ctx.wallFlat`, tous les murs OSM à plat) — les
    boîtes de collision sont droites, les murs en biais. Pas de trou sur les
    voitures (colliders `car: true`).
  - Carrefours (`buildOsmRoads`) : `onOtherRoad` écarte bordures, caniveaux,
    pointillés et zébras posés sur la chaussée d'une autre rue ; rotule
    d'asphalte à chaque nœud partagé. Lucarnes/cheminées : 230 m à pied
    (450 m au-dessus de 30 m), sans ombre portée.
  - `src/world/pentes.js` (vrai relief) : escaliers de pierre drapés sur la
    pente pour chaque `highway=steps` OSM (`data.steps` : p, w, n, inc ;
    repli : voies piétonnes à plus de 18 %), jardin en terrasses et balcon-
    panorama de la montée de la Grande-Côte (`planGrandeCote`, emprise
    réservée avant les bâtiments). Les rubans de rue prennent la hauteur du
    sol à CHAQUE coin (`drape` dans `buildOsmRoads`, plus de murs de
    soutènement génériques), rotules pavées aux coudes. Marches et terrasses deviennent le
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
    Bord de l'eau : seul le vrai masque d'eau compte (±4 m) — l'ancienne
    bande de 14 m autour du tracé rasait la 1re rangée des quais.
    Arbres : jamais sur une chaussée (`makeRoadTest(roads, marge)`),
    alignements décalés perpendiculairement à la rue.
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
    `Date.now()` (même horaire chez tous), embarquement par E à quai ; à
    bord, `ctx.rideFollow(fn)` → `controls.setRideFollow` : les contrôles
    lisent la cabine à l'instant du rendu (ni physique ni lissage). Le
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
    `Date.now()` (même ciel pour tous) ; panneaux instanciés qui ne pivotent
    qu'autour de la verticale (shader) : ils restent sur l'horizon quand
    l'avion s'incline (4 draw calls).
  - PERF (portées d'affichage) : `render/instlod.js` `lodInstances(im,
    { minD, maxD })` range en tête les instances à portée et réduit
    `im.count` (arbres 3D < 150 m / imposteurs au-delà, stores, enseignes,
    édicules, balustres de ponts, mâts de lampadaires) — ne jamais masquer
    une instance par une échelle zéro, le GPU la traite quand même.
    `culling.js` : petit décor masqué selon sa taille apparente
    (100·r m, plus tôt s'il a beaucoup de pièces, plancher 150 m), objets
    ajoutés après le démarrage repris toutes les 2 s. Lucarnes/cheminées
    des tuiles : 450 m. Tuiles de bâtiments de 200 m. Les grands ensembles
    (place Bellecour…) sont parcourus élément par élément.
    `render/freeze.js` : matrices figées pour tout ce qui existe au
    démarrage (scène comprise, caméra et ce qu'elle porte exclues),
    recalculées seulement si position/rotation/échelle changent (contrôle
    avant chaque rendu) — `getWorldPosition` juste après un déplacement
    peut donc retarder d'une frame. Carte d'ombre recalculée une frame sur
    deux (la lumière ne suit le joueur que ces frames-là), toutes les frames
    en véhicule ou au-delà de 12 m/s. `?debug&nofreeze` pour comparer.
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
  - `src/world/avatars.js` : avatars Rocketbox (passants, Lucie, Marcel,
    Kévin) — `buildAvatar(nom)` a l'interface de `buildHuman` (group,
    hitMeshes, animate(phase, vitesse×2,6), clearTint, shirtMat) + talk(on) ;
    clips idle/walk/talk/sit par AnimationMixer (1 image sur 3 au-delà de 40 m),
    `{ seated: true }` = assis à table (terrasses, habitués des cafés) ;
    `swapForAvatar(ctx, objet, nom, opts)` remplace un PNJ sculpté déjà posé
    (marchands, patron du bouchon et convives, patronne) ; hors Élevé les noms
    sont ramenés à 3 femmes + 3 hommes (`pickName`) pour limiter le poids,
    modèles tournés de π (regard -z), Lambert hors palier Élevé, 3 draw
    calls chacun. Chargés en fond (6 au palier Moyen, 12 en Élevé, aucun
    en Bas) ; les passants sculptés sont échangés quand ils sont loin.
    Joueurs distants et bots de l'arène aussi (`remotes.js` `swapIn`,
    distribution `AVATAR_CAST` d'après le pseudo) : `setArmed` + `animateArmed`
    ramènent les bras en position de tir après l'animation (`aimBone`, sans
    hypothèse sur le repère des os), l'arme se pose sur le support `armR`
    recalé sur la main droite.
    Clips supplémentaires (captures Rocketbox, `tools/rocketbox`) : `run`
    (au-delà de 2,7 m/s) et `crouch` (`group.userData.crouch`). Mort : le
    corps bascule sur place 2,6 s (`fall` dans remotes.js, messages `death` /
    `akill`). `world/selfBody.js` : son propre corps à la 1re personne (même
    avatar `avatarFor(pseudo)`, tête et bras escamotés), aussi utilisé comme
    corps dans la killcam.
    Joueurs et bots : militaires en treillis (`PLAYER_CAST`, ramenés à
    `military_male_02` hors Élevé). `upgradeInPlace(ctx, human, nom, opts)` :
    remplace un humain sculpté par un avatar SANS changer de groupe ni
    d'objet (PNJ de `npcs.js`, Momo, toits-terrasses, cyclistes, habitués) —
    à préférer pour tout nouveau PNJ. Restent sculptés exprès : zombies de
    l'invasion, public du concert (bras animés os par os, perf).
    Équipes : losange au-dessus de la tête + brassard aux deux bras
    (`setBand`, anneau posé sur l'os du bras) — plus aucune lueur sur le corps.
    Arène : couleurs RELATIVES (rouge = ennemi, bleu = allié, tout le monde
    rouge en mêlée), tir ami autorisé — un coéquipier tué coûte 1 élimination,
    1 point et la « quenelle du karma » (−50 PV, `aevt` `tk`).
  - `src/world/human.js` (humains sculptés, repli et autres PNJ, UN SkinnedMesh par humain = 1 draw
    call : pièces fusionnées, os = anciens pivots armL/armR/foreL/legL/kneeL…,
    géométrie partagée, couleurs par sommet ; une arme se fixe sur l'os armR ;
    variantes `fem`, `veste`, `jupe`, `barbe`, coiffures court/casquette/
    long/chignon/chauve, carrure ±6 % — déduites des couleurs si absentes,
    figées pour les avatars des joueurs ; la TÊTE est sculptée sur sa propre
    grille fine `headCell` — 1,7 cm, 1,35 cm au palier Élevé — et fusionnée au
    tronc) et `src/world/statue.js` (Louis XIV,
    Saint-Exupéry et le Petit Prince).
  - Théâtre gallo-romain de Fourvière (ville OSM) : `theatre.js` (gradins
    praticables — `ctx.terrainHeight` réécrit dans l'emprise,
    `ctx.terrainMeshHeight` garde le maillage du sol sous la pierre),
    `concert.js` (concert permanent : PLAYLIST de tout l'album en boucle,
    titre + position de lecture déduits de `Date.now()` (`concertState` :
    track, next, t, playing), son spatial chargé à l'approche, écran géant en
    gros plan : la chanteuse est déplacée le temps du rendu dans une petite
    scène à part `closeScene` (même transformation que le théâtre, projecteurs
    propres) — jamais un 2e rendu de toute la ville ; faisceaux additifs
    dessinés le soir seulement), `singer.js`
    (la chanteuse des clips : modèle .glb riggé + os de mâchoire ajouté au
    chargement pour chanter, repli sculpté), `album.js` (titres, paroles par
    section). Ajouter un morceau : MP3 dans `client/public/music/` + une
    entrée dans `album.js`. Clip remplacé sur le VPS sans git :
    `node tools/fetch-clip.mjs <lien Drive> <nom>` → `server/data/clips/`
    (servi en priorité, `Cache-Control: no-cache`). Hors palier Élevé, la
    texture du clip n'est envoyée au GPU que 12 fois/s et la chanteuse ne
    porte pas d'ombre. Le HUD affiche les ms processeur par frame.
  - `src/world/roadfit.js` : rues ajustées aux façades (lancer de rayons
    sur les empreintes OSM, au chargement, ~0,2 s) : `road.rw` = largeur de
    chaussée rendue, `road.sw[i]` = trottoirs [gauche, droite] par tronçon
    jusqu'aux façades proches (≤ 4,5 m ; pavés de mur à mur). `road.w`
    reste la CLASSE (seuils) ; tout décalage latéral passe par
    `roadHalf(road)`. Le tracé n'est pas déplacé (réseau connecté).
  - Circulation (`traffic.js`) : en ville OSM, `buildTraffic(..., data.roads)`
    fait rouler une flotte recyclée autour du joueur sur le VRAI réseau
    (rues ≥ 7 m, voie de droite, sens uniques OSM `road.o` = ±1 exportés
    par fetch-osm (deux voies dans le même sens), relief et tabliers de pont via
    `ctx.terrainHeight`), berlines/décapotables conduisibles garées au bord
    des rues de 5,5 m ; les avenues de berge inventées ne servent plus qu'à
    la ville procédurale. Parapet des quais : `ctx.waterGuard` →
    `controls.setWaterGuard` empêche de descendre à pied dans le lit.
  - `src/world/missions.js` : PNJ causeurs de plein air (`createTalkers` :
    Lucie la guide à Fourvière, Guignol au castelet, Marcel à la ficelle,
    Kévin supporter de l'OL à Bellecour — posés à la 1re frame près de leur
    POI) et MISSIONS : bouton 📜 du dialogue → `POST /api/npc/quest` (Claude
    choisit un POI réel parmi ~10 envoyés + invente l'objet ; repli modèle
    sans IA), balise dorée + repère carte (`ctx.mapMarks`), ramassage à 9 m,
    retour au PNJ (remise à l'ouverture du dialogue) → `/npc/quest/done`
    (+80 XP, délai mini 20 s côté serveur). Encart de quête : la mission
    passe avant la quête de l'arsenal (`ctx.setMissionQuest`).
    Passants (`passersby.js`) : bulles de petites phrases (jour/nuit/pluie) ;
    trottoirs calculés à la 1re frame (les fontaines des places existent
    alors), tout obstacle de plus de 35 cm les coupe.
  - `src/world/hifi.js` + `arena.js` : ARÈNE DE BELLECOUR (carte fermée bâtie
    à x = 20000, entrée par la zone du Roi de la colline, sortie par le
    portail doré). Dépôt de conteneurs autour de Louis XIV (UN InstancedMesh
    + colliders, disposition symétrique par demi-tour, `makeRand`), décor
    fixe cuit (`flattenColored`), immeubles avec les façades de la ville
    (`facadeShaderPatch`, mêmes conventions d'UV) + toits Mansart cuits :
    ~10 draw calls. Orage permanent dans l'arène : `setRainFloor` (weather.js,
    plancher LOCAL de `rainAmount`) + `setRoadWetness` (road.js).
  - MATCHS DE L'ARÈNE : `shared/arena-layout.js` = plan de l'arène (données
    pures : conteneurs, obstacles, bases, `arenaBoxes()`), lu par le client
    (décor + collisions) ET le serveur. `server/src/arena.js` : matchs
    autoritatifs dès qu'un joueur est à x ≈ 20000 — modes `ffa`, `tdm`,
    `ctf`, `zone`, `sniper`, `couteau` (manche chronométrée + score limite, 12 s
    d'entracte, enchaînement `rotation` ou `meme`), 1 à 10 bots, 4
    difficultés (`DIFFS`). Les bots sont simulés au tick de ws.js (A* sur
    grille 1 m, ligne de tir par boîtes) et diffusés comme des JOUEURS
    (`pjoin` avec `bot: 1`, `states`, `shot`) : le client leur tire dessus
    par le `hit` habituel. Un joueur qui entre remplace un bot ; équipes
    redistribuées à chaque manche. Messages : `arena` (état, 1/s),
    `arenaTop`, `arenaSpawn`, `akill`, `aevt`, `arenaCfg` (client → serveur) ;
    `death` porte `sp` (réapparition dans l'arène) et `xp` optionnels.
    Scores : `arena_<mode>` dans la table scores. Client :
    `world/arenaMatch.js` (bandeau, fil des éliminations, tableau Tab,
    drapeaux, console de match, tableau des meilleurs au-dessus du portail,
    `weapon.setLoadout` pour snipers/couteaux, `remotes.setTeam`). Entrée
    permanente : portail doré au pied de Louis XIV (POI `roi`).
  - GRENADES ET SÉRIES (arène) : `shared/arena-nade.js` = physique de la
    grenade (`stepNade`, rebonds sur `arenaBoxes()`), jouée par le serveur
    (qui décide de l'explosion et des dégâts, arrêtés par les obstacles, tir
    ami compris) ET par chaque client (affichage) — la trajectoire ne passe
    pas sur le réseau. 2 grenades + 1 fumigène par vie, pas en modes snipers
    / couteaux. Le fumigène coupe la ligne de vue des bots (`smokeBlocks`).
    Messages : `nade` (client → serveur : `k`, `d` ; serveur → clients :
    `id`, `p`, `v`), `boom` (`k` f/s/q, `in` = délai pour la frappe),
    `nadeInv` (dotation + armure). Séries d'éliminations d'un joueur
    (`onStreak`) : 3 = drone-pigeon (noms ennemis révélés 12 s, côté client),
    5 = frappe de quenelles (6 impacts annoncés par un cercle rouge), 7 =
    armure de canut (100 points, `absorb`). Client : `world/nades.js`
    (touches physiques KeyQ / KeyZ, boutons 💣 💨, clics de sticks).
    Les bots lancent aussi (à partir de « normal », 1 grenade par vie) :
    `aimNade` simule 7 inclinaisons et garde celle qui tombe le plus près.
    Mode `zone` (zone à tenir) : cercle de 7 m qui bouge toutes les 45 s,
    1 point par seconde à l'équipe la plus nombreuse dedans (`tickZone`,
    champ `z` de l'instantané `arena`). Escalade : en l'air contre un rebord
    à moins de 1,3 m au-dessus des pieds, `controls.js` donne un second élan
    (on grimpe sur un conteneur en sautant contre lui).
    Rosettes de soin (`MEDS` dans arena-layout.js) : +50 PV au premier
    blessé qui passe dessus, retour 25 s après (`tickMeds`, champ `m` de
    l'instantané `arena`, `aevt` `med`, message `hp` avec `regen`) ; les bots
    sous 45 PV vont en chercher une (sauf en facile). Bases peintes au sol en
    modes par équipes (bleu = la sienne). Lumière : dans l'arène
    (`ctx.inHiFi`), `daylight` ne descend jamais sous 0,75 (jour couvert) +
    plancher « projecteurs » dans `updateEnvironment`.
    Passerelles et escaliers (`WALKS`, `STAIRS` dans arena-layout.js) :
    dalles minces à hauteur de toit de conteneur + marches de 53 cm
    (≤ `STEP_UP`), dans `arenaBoxes()` — la grille des bots ignore les boîtes
    dont le bas est au-dessus de 1,4 m. Radar (`drawRadar`, arenaMatch.js) :
    canvas redessiné 8×/s, alliés toujours, ennemis 2,5 s après un tir
    (tireur déduit de l'origine du message `shot`) ou sous drone-pigeon.
    Explosion de grenade : `blast` dans nades.js (éclair, boule de feu, onde
    au sol, fumée, trace de brûlé — sprites additifs, aucun éclairage).
    Caisse du Gros Caillou (`CRATE`, `tickCrate`, champ `c`, `aevt`
    `crate`) : au pied de la statue 25 s après le début de la manche puis
    50 s après chaque ramassage ; le joueur qui passe dessus reçoit le
    minigun jusqu'à sa mort (`special` dans arenaMatch.js → `setLoadout`,
    ses autres armes restent). Pas en snipers / couteaux, pas pour les bots.
  - ARSENAL DE L'ARÈNE ET CLASSES : `mp5`, `m16`, `m4`, `famas`, `kar98k`,
    `epee`, `dagues`, `lance` (lance et bouclier) ajoutés en FIN de
    `WEAPON_IDS` (codes 10 à 17 ; grenade et quenelle du fil des
    éliminations passées à 100/101). Modèles détaillés dans
    `weaponModels2.js` (même atelier `kit()` que l'AK : profils extrudés,
    fusion par matériau). Sons : `audio.shotOf(id)` (claquement / corps /
    queue par arme, verrou du Kar98k), `swingOf(id)`, `bladeHit()`.
    Gestes dans la pose de `weapon.js` : taille de l'épée, estocs alternés
    des dagues (`swingSide`), coup de lance, verrou (`boltT`), bascule de
    l'arme au rechargement.
    Prises des mains (`GRIPS` dans weapon.js) relevées sur chaque modèle :
    poignée pistolet à droite, garde-main / poignée avant du M4 / fût du
    Kar98k / énarme du bouclier à gauche — à recaler si un modèle change.
    Mains (`buildArm` dans arms.js) : doigts à 3 phalanges enroulés,
    index droit tendu vers la détente, pouce en 2 phalanges, manchette de
    gant, manche aplatie à plis — toutes les pièces fusionnées par matériau
    (`add` + `mergeGeometries`), ne plus ajouter de Mesh isolé au bras.
    Doigt d'honneur : deux éliminations d'affilée sur le même adversaire
    (`lastVictim` dans arenaMatch.js, message `akill`) → `ctx.flipOff()` →
    `arms.flipOff()` (bras gauche à part, `buildArm(-1, { finger: true })`).
    Vu par TOUS sans message réseau : remotes.js suit `lastVictimOf` sur les
    `akill` et appelle `human.flipOff()` (avatars.js `poseFlip` : bras gauche
    levé par `aimBone` + poing au majeur tendu rapporté sur la main).
    1re personne : majeur NU (mitaine, peau sur gant noir, +30 %, ongle),
    bras au centre de l'écran, deux coups de poing secs.
    Tirs des autres : `net.on('shot')` (main.js) joue `audio.shotOf(arme,
    vol)` atténué par la distance (120 m, 1 son / 70 ms au plus), l'arme
    venant de `remotes.weaponIdOf(id)`. Bots : arme AFFICHÉE variée
    (`BOT_GUNS` : AK, MP5, M16, M4, FAMAS selon `seed`), dégâts inchangés.
    Bruit de pluie RETIRÉ (demande de Polo, 13/11/2026) : `audio.rain` ne
    fait plus que couper le son — ne pas le rétablir.
    VISÉE ALIGNÉE : `SIGHTS` (weapon.js) = [u, v] de la hausse et du guidon
    par arme ; à l'épaule, l'arme pique de l'angle qui met les deux à la
    même hauteur et descend pour que la ligne passe par l'œil. Une hausse
    doit laisser VOIR le guidon (œilleton en anneau, pas de bloc plein) ;
    tout nouveau modèle à visée ouverte doit avoir son entrée `SIGHTS`.
    `SIGHTS[id]` = [u, v hausse, u, v guidon, distance RÉELLE œil → hausse].
    En visée, le porte-arme (mains comprises) est agrandi de `ADS_SCALE` = 2
    autour de l'œil : même image qu'une arme réelle joue posée, mais rien
    sous le plan proche (0,1 m). La ligne passe 2 mm au-dessus de la pointe
    du guidon et par le haut du cran / le centre de l'œilleton. Organes de
    visée en noir MAT (`SIGHT`, `APERTURE`, aides `aperture()` et `ears()`
    dans weaponModels2.js) ; un anneau doit FAIRE FACE à l'œil (pas de
    rotation y). Réticule masqué quand `weapon.sightsUp`. Contrôle chiffré :
    projeter hausse et guidon à l'écran (doivent tomber au centre). Optiques (point rouge du M4) : tube CREUX
    (`CylinderGeometry` ouvert, matériau `TUBE` double face), lentille
    `LENS` quasi transparente, point `DOT` — jamais de cylindre plein.
    POSES DES AVATARS ARMÉS (`poseArmed`, avatars.js) par famille, choisie
    dans remotes.js : `fusil`, `double` (akimbo, dagues : une arme par main,
    support au milieu des mains), `melee` (épée, couteau, marteau, bâton),
    `lance` (bouclier remonté devant le bras gauche). Réglage : mannequin
    immobile par `net.inject` (?debug) — `pjoin` puis `states` répétés.
    Kar98k : `kar98k` (sans lunette, 5 cartouches d'un coup) et `kar98ks`
    (code 18, lunette ×2,5 / ×6 via `spec.scope`, rechargement balle par
    balle `roundReload`, interrompu par le tir) — 55 dégâts au corps,
    `headKill` = 100 à la tête (main.js) ; plafond serveur des gros calibres
    ramené à 0,9 s. `spec.dual` (dagues) centre le porte-arme comme l'akimbo.
    BOUCLIER (lance, code 17) : de face (±65°), il ARRÊTE les balles
    (joueurs dans ws.js, bots dans `damageHuman` d'arena.js, test commun
    `arena.shieldBlocks`) ; un coup de lame (`hit` avec `m: 1`, couteau des
    bots) passe à 40 %. Balle arrêtée → message `blk` (id, by) : « tang »
    `audio.shieldBlock` + écu gris `ui.blocked()` pour le tireur.
    ARMES BLANCHES (`player/melee.js`) : `pivotize` range chaque lame dans
    un PIVOT posé sur le poing (R, et L pour la 2e dague ; lance seule, le
    bouclier reste) ; prises `on: 'R'|'L'` (arms.js accroche la main au
    pivot, IK épaule → poing pendant le geste : l'avant-bras ne tourne pas
    avec la lame) ou `cam: true` (main libre en garde sur la caméra : épée,
    couteau). `ATTACKS[id]` = armé + frappe ; coups rapprochés (< 0,75 s) =
    enchaînement qui croise, sinon ouverture au hasard ; dagues alternées
    (gauche en miroir). Le porte-arme ne fait plus qu'un petit avancé.
    Portées : épée 4,9, dagues 3,7, lance 6,3, couteau 3,8, marteau 4,4,
    bâton 4,2. ?debug : `__meleeT` fige le geste, `__meleeHands`/`__meleeAtk`.
    DÉPLACEMENT (controls.js, 13/11/2026) : course 6,5 m/s (−35 %), saut
    8 m/s, gravité 17 (≈ 1,9 m), ACCEL 12 — « 10 m/s était injouable ».
    CLASSE (arenaMatch.js) : 2 armes parmi
    `CLASS_WEAPONS`, menu touche K / bouton CLASSE, `localStorage
    lyon_class` ; `classPick` (menu) ne devient `classActive` (en main)
    qu'à la mort, au début d'une manche ou en entrant. Molette assignable :
    codes `WheelUp` / `WheelDown` dans bindings.js.
  - MORT : RAGDOLL des avatars (`ragdollStart/Step/Stop` dans avatars.js) —
    15 points reliés par des tiges (Verlet, gravité, sol, frottement), tronc
    contreventé ; le groupe est tourné/déplacé pour suivre le tronc, chaque
    os de membre est pointé le long de sa tige (`aimWorld`). Piloté par
    `fall(id, by)` de remotes.js pendant 2,6 s (les humains sculptés gardent
    la bascule) et par killcam.js pour son propre corps. Pas de collision
    avec les murs. `render/gore.js` : gerbes de
    sang (Points recyclés) à chaque touche, flaque sous le corps (2 draw
    calls ; `localStorage lyon_gore = '0'` coupe). `audio.scream(vol,
    variante)` : cri synthétisé (dents de scie + 3 formants), 5 variantes.
  - DÉTENTES (`weapon.js`) : sources `mouse0/mouse2` + `ext` (manette,
    tactile) recombinées à chaque `update`. Arme normale : clic gauche /
    gâchette droite = tir, clic droit / gâchette gauche = visée ; fusil de
    précision (souris, manette) : visée = lunette, tir = clic gauche ;
    double pistolets : chaque main son pistolet. Glissade : action
    `AltLeft` (bindings.js), boutons de souris assignables (`Mouse1/3/4`).
  - Ombres : les maillages de moins de 45 cm de rayon ne portent pas
    d'ombre (traversée de main.js).
  - PALIER AUTOMATIQUE (`quality.js`) : puce intégrée (Intel UHD/HD/Iris,
    rendu logiciel — `weakGpu`) → Moyen d'office sur PC. Garde de fluidité
    (main.js) : moins de 26 images/s pendant ~8 s → un palier plus bas, sauf
    palier choisi à la main (`lyon_quality_manual`, posé par `cycle()`).
  - MANIEMENT : `weapon.js` `HANDLING` (dispersion, recul, zoom de visée par
    arme) — visée à l'épaule (clic droit / bouton VISER), dispersion qui
    grossit en rafale / en courant / en l'air et se resserre accroupi ou à
    l'épaule (`weapon.spread` → réticule `ui.setSpread`), recul appliqué à
    la visée par `controls.kick`. Accroupi : Maj / bouton BAS
    (`controls.crouched`, champ réseau optionnel `cr`, dernier champ de
    `states`), en pleine course = glissade. `world/killcam.js` : rejeu des
    2 s avant / 1 s après la mort dans l'arène, depuis l'épaule du tueur,
    à partir des 7 s de positions et de tirs gardées côté client (rien de
    demandé au serveur) ; à appeler après `remotes.update`.
  - DIAGNOSTIC : toucher/cliquer le texte en haut à gauche déplie les
    compteurs du rendu (draw calls et triangles cumulés sur toute l'image,
    avatars dessinés/total, taille d'image, palier, GPU) — à demander en
    capture avant toute optimisation. Mesures de référence (palier Moyen,
    ville OSM, Bellecour) : ~520 draw calls, ~2 M triangles ; arène avec 10
    bots : ~145 draw calls, ~160 k triangles.
  - PERF avatars : `cullAvatars(camera)` (avatars.js, appelé avant chaque
    rendu) masque le MODÈLE des avatars hors champ ou à plus de 130 m — leurs
    maillages ont `frustumCulled = false`, sans ce tri ils partaient tous au
    GPU. Hors Élevé : pas d'ombre portée (ombres de contact rondes,
    `render/blobs.js`), textures réduites à 256 px. Animation 1 image sur 3
    au-delà de 30 m, 1 sur 8 au-delà de 70 m ou hors champ.
    Tout InstancedMesh qui couvre la ville avec `frustumCulled = false` DOIT
    passer par `lodInstances` (les arbustes et cyprès des jardins ne
    l'avaient pas : 280 k triangles dessinés partout, arène comprise).
    `render/tiles.js` `tileBigMeshes(scene)` (appelé juste avant le premier
    rendu) redistribue en tuiles de 520 m les maillages fusionnés à l'échelle
    de la ville (pavés, trottoirs, sol, murs/haies des jardins, escaliers :
    13 maillages → 345 tuiles) ; `cullTiles` masque celles hors portée de
    vue. Mesuré au palier Moyen à Bellecour : 877 → 761 draw calls, 2,57 →
    1,58 M triangles (`?debug&notiles` pour comparer). L'original quitte la
    scène mais reste référencé (`userData.tiles`) — un nouveau maillage de
    ville n'a rien à faire de spécial. Le diagnostic MOYENNE ses compteurs
    (la carte d'ombre n'est rendue qu'une image sur deux).
  - `render/impacts.js` : impacts de balles en 3 draw calls (étincelles et
    poussière en Points, trous en InstancedMesh recyclé). `surfaceAt` (main.js)
    donne la normale et la matière (`metal` sur les colliders des
    conteneurs) ; `worldHitDistance` affine l'impact par dichotomie.
    Éclairs : calés sur `Date.now()` dans `updateEnvironment` (`env.flash`),
    sous orage seulement. Éclaboussures de pluie : Points dans weather.js.
  - COMMANDES : `ui/bindings.js` — touches reconfigurables SANS toucher aux
    lectures de touches du jeu : un écouteur en capture traduit la touche
    choisie vers le code d'origine de l'action et réémet l'événement
    (`press(code, down)`) ; menu « Commandes » (touche N, Start à la
    manette), `localStorage lyon_keys`. `player/gamepad.js` : manette lue à
    chaque image (sticks → `controls.setTouchMove` / `addLook`, gâchettes →
    `weapon.setTrigger` / `setAds`, boutons → `bindings.press`),
    `state.gamepadActive` débloque les entrées sans capture de souris.
    Tactile : éditeur de disposition des boutons dans `ui/touch.js` (menu ☰
    → Réglages → Modifier ; glisser, taille ± ; centre en fraction d'écran
    par emplacement, `localStorage lyon_touch_layout`).
  - Orage (`env.storm`, main.js) : sous l'averse, ciel/brume/lumières virent
    vers `ENV_STORM`, `post.setStorm` refroidit l'étalonnage. Look caméra
    (grain, aberration chromatique, barillet) dans la passe d'étalonnage de
    `post.js` — aucune passe ajoutée. HUD « tactique » : bloc en fin de
    `ui/styles.css` ; `ui.setCompass(yaw)`, `ui.contact(dx, dz, yaw)`
    (direction du tireur, champ `by` du message `hp`).
  - `src/world/rdv.js` : rendez-vous — toucher la carte (M) pose une balise
    vue par tous 90 s (WS `t: 'rdv'`, relayé par le serveur, 1 / 8 s).
  - Définition d'image plafonnée par un budget de pixels (`basePixelRatio`
    dans main.js : 2,1 Mpx tactile, 3,7 Mpx PC), recalculé au redimension-
    nement (Fold plié/déplié).
  - `src/player/` — contrôles FPS + tactile, arme (modèles détaillés dans
    `weaponModels.js`), joueurs distants, voix.
  - `src/games/` — bornes d'arcade : mini-jeux HTML autonomes en iframe
    sandbox (`builtin/`), pont clavier par postMessage (`shell.js`).
  - `src/tags/` — bombe de peinture, décals réseau, éditeur de tags.
  - `src/progress.js` — niveaux (`levelOf`) et définitions des succès.
- `server/` — Express + ws + better-sqlite3. `env.js` charge `.env` (racine)
  au démarrage. `ai.js` : client Anthropic partagé + bornes (Sonnet).
  `npcTalk.js` : dialogues libres des PNJ (Claude Haiku, personas `patron`,
  `patronne`, `marchand`, `bouquiniste`, `guide`, `guignol`, `conducteur`,
  `supporter` ; missions `npcQuest`/`npcQuestDone`), historique serveur 15 min, quotas
  joueur + `NPC_DAILY_CAP`) → `POST /api/npc/talk`. `tts.js` : voix Piper
  (une voix par persona, `GET /api/tts/:id` seulement pour les répliques
  émises par le serveur, cache WAV dans `server/data/tts-cache`), installé
  en tâche de fond par `tools/install-piper.mjs`. `stt.js` : micro → texte
  (whisper.cpp compilé par `tools/install-whisper.mjs`, `POST /api/stt` en
  WAV 16 kHz mono brut, prompt de vocabulaire lyonnais, une transcription à
  la fois, hallucinations « sous-titres » filtrées). Client : `ui/talk.js`
  (`ctx.talkTo(id, { title, emoji, greet, fallback })` → false si l'IA est
  coupée, le PNJ garde alors ses répliques fixes). Micro : reconnaissance
  NATIVE du navigateur si dispo (webkitSpeechRecognition, texte en direct ;
  🎤 = mode conversation mémorisé : le micro se rouvre quand le PNJ a fini
  de parler), sinon repli whisper (MediaRecorder → OfflineAudioContext
  16 kHz → WAV). Piper démarre dès la réponse produite, sans attendre le
  client. `ws.js` : positions 15 Hz, PvP
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
