import fs from 'node:fs';

// MISE À JOUR AUTOMATIQUE DE LA CARTE OSM
//
// Une GitHub Action (.github/workflows/osm-data.yml) régénère
// lyon-osm.json avec tools/fetch-osm.mjs et le publie sur la branche
// `osm-data` du dépôt (public). Au démarrage — donc à chaque déploiement —
// puis toutes les 6 h, le serveur récupère cette version et remplace
// client/public/lyon-osm.json si elle a changé : les améliorations du
// script (bâtiments à cours intérieures…) arrivent en prod sans relancer
// fetch-osm à la main sur le VPS. Le fichier est servi à chaque requête,
// pas besoin de redémarrer. OSM_AUTO_UPDATE=0 pour couper.
const DEFAULT_URL = 'https://raw.githubusercontent.com/Polo-dium/vibevps/osm-data/lyon-osm.json';
const EVERY_MS = 6 * 60 * 60 * 1000;

export function startOsmAutoUpdate(target) {
  if (process.env.OSM_AUTO_UPDATE === '0') return;
  const url = process.env.OSM_DATA_URL || DEFAULT_URL;
  const run = async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const data = JSON.parse(text);
      // Garde-fou : jamais remplacer une bonne carte par un fichier tronqué
      if (!Array.isArray(data.buildings) || data.buildings.length < 1000 || !Array.isArray(data.roads)) {
        throw new Error('fichier incomplet');
      }
      const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (current === text) return;
      const tmp = `${target}.tmp`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, target); // atomique : jamais de fichier à moitié écrit servi
      console.log(`Carte OSM mise à jour depuis GitHub (${data.buildings.length} bâtiments).`);
    } catch (err) {
      console.warn(`Mise à jour OSM ignorée : ${err.message}`);
    }
  };
  run();
  setInterval(run, EVERY_MS).unref();
}
