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
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api|ws).*/, (req, res) => {
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
