// Charge le .env à la racine du dépôt AVANT tout le reste (import en tête de
// index.js). Le cron de déploiement relance le serveur sans passer par
// systemd/EnvironmentFile : sans ça, ANTHROPIC_API_KEY n'arrivait jamais au
// processus. Les variables déjà définies dans l'environnement gardent la main.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of [path.join(root, '.env'), path.join(root, 'server', '.env')]) {
  if (!fs.existsSync(f)) continue;
  try {
    process.loadEnvFile(f); // Node ≥ 20.12 : n'écrase pas les variables existantes
    console.log(`Configuration chargée depuis ${path.relative(root, f)}`);
  } catch (err) {
    console.warn(`.env illisible (${f}) :`, err.message);
  }
}
