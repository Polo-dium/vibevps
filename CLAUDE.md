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
  - `src/world/` — ville procédurale (`city.js`), vrai Lyon OSM optionnel
    (`cityReal.js`, activé si `client/public/lyon-osm.json` existe, généré par
    `tools/fetch-osm.mjs`), ciel (`sky.js`), PNJ (`npcs.js`).
  - `src/player/` — contrôles FPS + tactile, arme, joueurs distants, voix.
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
