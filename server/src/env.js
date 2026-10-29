// Charge le .env à la racine du dépôt AVANT tout le reste (import en tête de
// index.js). Le cron de déploiement relance le serveur sans passer par
// systemd/EnvironmentFile : sans ça, ANTHROPIC_API_KEY n'arrivait jamais au
// processus.
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const f of [path.join(root, '.env'), path.join(root, 'server', '.env')]) {
  if (!fs.existsSync(f)) continue;
  try {
    // Une variable déjà définie garde la main… sauf si elle est VIDE (un
    // `ANTHROPIC_API_KEY=` traînant dans systemd ou pm2 masquait la clé).
    for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(f, 'utf8')))) {
      if (!process.env[k]?.trim()) process.env[k] = v;
    }
    console.log(`Configuration chargée depuis ${path.relative(root, f)}`);
  } catch (err) {
    console.warn(`.env illisible (${f}) :`, err.message);
  }
}
