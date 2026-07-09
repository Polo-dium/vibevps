# Vraie musique (facultatif)

Le jeu synthétise sa musique en WebAudio (zéro fichier, `client/src/music.js`).
Un vrai enregistrement peut venir compléter l'offre : un fichier posé ici est
servi automatiquement par le serveur (aucun rebuild nécessaire), exactement
comme `/pano/fourviere.jpg`.

Ce dossier EST suivi par git (contrairement à `lyon-osm.json` ou `/pano/`) :
un MP3 de quelques Mo ne pèse pas lourd dans l'historique, et c'est le seul
canal de déploiement fiable pour un fichier ajouté via Claude Code (pas
d'accès SSH direct au VPS). Si tu préfères éviter d'alourdir le dépôt, tu
peux toujours déposer un fichier directement sur le serveur sans le committer
— dans ce cas ajoute son nom à `.gitignore`.

## Fichier actif

```
client/public/music/clair-de-lune.mp3
```

Référencé dans `client/src/music.js` (`REAL_TRACKS`), disponible dans le
cycle de l'enceinte portable (touche **B** en jeu, dernier morceau du cycle).
Si un fichier venait à manquer, ce morceau échoue silencieusement (un
avertissement dans la console du navigateur, rien de cassé).

## Où trouver un enregistrement vraiment libre de droits

La **partition** de Clair de Lune (Debussy, 1905) est dans le domaine public.
Un **enregistrement** précis (un pianiste qui la joue) a ses propres droits,
sauf mention explicite du contraire. Sources fiables, à vérifier au cas par
cas sur la page du fichier :

- **Musopen.org** — musopen.org/music/pieces (chercher « Clair de Lune ») :
  association dont la mission est justement de publier des enregistrements
  classiques en domaine public.
- **Wikimedia Commons** — commons.wikimedia.org, catégorie
  « Clair de lune (Debussy) » : chaque fichier affiche sa licence
  exacte (PD-old-70, CC0…) directement sur sa page.
- **IMSLP** (imslp.org) — surtout des partitions, mais aussi quelques
  enregistrements domaine public.

Télécharge le fichier, renomme-le `clair-de-lune.mp3` (ou adapte le nom dans
`REAL_TRACKS` côté code), dépose-le ici sur le VPS. Format MP3 recommandé
(compatibilité Safari/iOS bien meilleure que l'OGG).

## Ajouter d'autres morceaux

Dans `client/src/music.js`, ajoute une entrée à `REAL_TRACKS` avec un nouvel
identifiant (5, 6…) et le nom du fichier, puis ajoute-la à `TRACKS`. Elle
apparaît automatiquement dans le cycle de l'enceinte portable, et peut aussi
être assignée à un bar (`buildTerrasse(..., track)` dans `city.js`) ou à
l'autoradio d'une décapotable (`traffic.js`).
