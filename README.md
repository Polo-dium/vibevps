# VibeVPS — Lyon Arcade

Une ville 3D explorable inspirée de Lyon, jouable dans le navigateur, en
multijoueur temps réel :

- 🏙️ **Ville low-poly inspirée de Lyon** : la Presqu'île entre Rhône et Saône,
  la place Bellecour et sa statue, les ponts, la colline de Fourvière et sa
  basilique, la tour Part-Dieu « le Crayon », le mur peint façon Croix-Rousse.
- 🕹️ **Salle d'arcade** où l'on entre librement : Tetris, Pacman, Snake,
  Breakout sur de vraies bornes, avec **leaderboards** partagés.
- 🤖 **Éditeur de mini-jeux IA** : décris un jeu sur la borne « CRÉER », Claude
  Sonnet le code, et la nouvelle borne apparaît dans la salle pour tout le
  monde (jeux exécutés dans des iframes sandboxées).
- 🎨 **Tags / graffiti** : un éditeur de dessin intégré, et tu sprayes tes tags
  sur les murs de la ville et de la salle — visibles par tous, persistés.
- 🔫 **Stand de tir** : AK-47, cibles qui surgissent, score et précision.
- 👥 **Multijoueur** : les autres joueurs sont visibles en temps réel
  (WebSocket), pseudo simple sans mot de passe.

## Lancer sur le VPS

```bash
npm install          # installe la racine + client + serveur (workspaces)
npm run build        # compile le client (client/dist)
cp .env.example .env # puis renseigne ANTHROPIC_API_KEY dans .env
export $(grep -v '^#' .env | xargs)
npm start            # sert le jeu sur http://0.0.0.0:3000
```

Sans `ANTHROPIC_API_KEY`, tout fonctionne sauf la création de bornes IA
(la borne « CRÉER » renvoie un message explicite).

Pour un service persistant, par exemple avec systemd :

```ini
[Unit]
Description=VibeVPS Lyon Arcade
After=network.target

[Service]
WorkingDirectory=/opt/vibevps
EnvironmentFile=/opt/vibevps/.env
ExecStart=/usr/bin/node server/src/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

## Développement

```bash
npm install
npm run dev   # serveur API sur :3000 + Vite sur :5173 (proxy /api et /ws)
```

## Contrôles

| Touche | Action |
|---|---|
| ZQSD / WASD | Se déplacer (clavier physique : marche en AZERTY et QWERTY) |
| Shift | Sprint |
| Espace | Saut |
| E | Interagir (bornes, stand de tir, borne « CRÉER ») |
| F | Sprayer le tag équipé sur le mur visé |
| T | Ouvrir l'éditeur de tags |
| 1 | Sortir / ranger l'AK-47 |
| R | Recharger |
| L | Classements de tous les jeux |
| P | Panneau admin (modération des tags) |
| X | (admin) Supprimer le graffiti visé |
| Échap | Fermer le panneau ouvert |

## Mode admin

Définis `ADMIN_KEY` dans l'environnement du serveur, puis en jeu : touche **P**,
entre la clé. Une fois admin : vise un tag et appuie sur **X** pour le
supprimer (synchronisé chez tous les joueurs), ou utilise le bouton « Supprimer
tous les tags » du panneau P. Le statut admin est lié à ton pseudo (persistant).

## Architecture

```
server/   Node + Express + ws + SQLite (better-sqlite3)
  src/index.js   serveur HTTP + statique + WebSocket
  src/api.js     REST : pseudos, scores, tags, génération IA
  src/ws.js      positions des joueurs (15 Hz), broadcast tags/bornes/scores
  src/ai.js      appel Claude Sonnet (claude-sonnet-4-6) en streaming
  src/db.js      schéma SQLite + requêtes préparées

client/   Vite + Three.js
  src/world/     ville de Lyon (génération déterministe), arcade, stand de tir
  src/player/    contrôleur FPS (collisions AABB + step-up), AK-47, joueurs distants
  src/tags/      éditeur de dessin 2D + spray de décals
  src/games/     shell iframe sandboxée + 4 jeux intégrés
  src/ui/        HUD, classements, créateur de borne IA
```

**Contrat des jeux** (intégrés comme générés par IA) : un document HTML
autonome dans une iframe `sandbox="allow-scripts"`, qui envoie
`postMessage({type:'arcade:score', score})` en fin de partie. Le shell
soumet alors le score au serveur, qui met à jour le leaderboard et le
diffuse à tous les joueurs connectés.
