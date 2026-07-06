import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api } from './api.js';
import { setupWs } from './ws.js';
import { aiAvailable } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);

const distDir = path.join(__dirname, '..', '..', 'client', 'dist');
const publicOsm = path.join(__dirname, '..', '..', 'client', 'public', 'lyon-osm.json');

// IMPORTANT : la carte OSM est servie EN PRIORITÉ depuis client/public (là où
// `node tools/fetch-osm.mjs` l'écrit), pas depuis le build. Ainsi, régénérer
// l'OSM prend effet tout de suite (au prochain redémarrage), sans avoir à
// relancer un build complet — sinon on continue de servir l'ancienne carte.
app.get('/lyon-osm.json', (req, res) => {
  const distOsm = path.join(distDir, 'lyon-osm.json');
  const file = fs.existsSync(publicOsm) ? publicOsm : distOsm;
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  if (fs.existsSync(file)) res.sendFile(file);
  else res.status(404).end();
});

if (fs.existsSync(distDir)) {
  // Les assets JS/CSS ont un hash dans leur nom → cache long OK. Mais
  // index.html et lyon-osm.json NE DOIVENT PAS être mis en cache par le
  // navigateur, sinon on continue de charger l'ancien bundle après un
  // déploiement (symptôme : « c'est toujours pareil » malgré les mises à jour).
  app.use(express.static(distDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html') || filePath.endsWith('lyon-osm.json')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    },
  }));
  app.get(/^\/(?!api|ws).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res
      .status(503)
      .send('Client non compilé. Lance « npm run build » à la racine du projet.');
  });
}

const server = http.createServer(app);
setupWs(server);

server.listen(PORT, () => {
  console.log(`VibeVPS — Lyon Arcade en écoute sur http://0.0.0.0:${PORT}`);
  console.log(
    aiAvailable()
      ? 'Éditeur IA : actif (clé Anthropic détectée).'
      : 'Éditeur IA : INACTIF — définis ANTHROPIC_API_KEY pour activer la création de bornes.'
  );
});
