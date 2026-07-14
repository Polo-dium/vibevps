import express from 'express';
import compression from 'compression';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { api } from './api.js';
import { setupWs } from './ws.js';
import { aiAvailable } from './ai.js';
import { getOgImage } from './ogImage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.disable('x-powered-by');
// L'état multijoueur et la carte OSM sont très compressibles. Cette couche
// protège aussi les déploiements où le reverse proxy n'active pas gzip/Brotli.
app.use(compression({ threshold: 1024 }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);

// Vignette de partage (og:image), générée une fois et mise en cache mémoire
app.get('/og-image.png', (req, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.end(getOgImage());
});

const distDir = path.join(__dirname, '..', '..', 'client', 'dist');
const publicOsm = path.join(__dirname, '..', '..', 'client', 'public', 'lyon-osm.json');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Vignette personnalisée quand on arrive via un lien d'invitation
// (?ami=Pseudo) : le titre du lien annonce directement qui attend en jeu —
// c'est ce qui fait qu'un lien collé dans WhatsApp donne envie de cliquer.
// Simple remplacement de chaînes sur le HTML déjà buildé (aucun template
// engine à maintenir), donc doit rester avant `express.static` pour
// intercepter la racine avant qu'elle ne serve index.html telle quelle.
app.get('/', (req, res, next) => {
  const ami = typeof req.query.ami === 'string'
    ? req.query.ami.trim().slice(0, 16).replace(/[^\p{L}\p{N} _.-]/gu, '')
    : '';
  if (!ami) return next();
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) return next();
  let html = fs.readFileSync(indexPath, 'utf8');
  const safeAmi = escapeHtml(ami);
  html = html
    .replace(/LYON ARCADE — Lyon en low-poly, multijoueur, dans ton navigateur/g,
      `${safeAmi} t’attend à Bellecour ! Rejoins-le sur LYON ARCADE`)
    .replace(/Tague Bellecour, pilote un avion, chevauche le silure, refais le monde en musique sur les quais[^"]*/g,
      `${safeAmi} est déjà en ville. Un clic pour le rejoindre — Lyon en low-poly, direct dans le navigateur.`)
    .replace(/<title>[^<]*<\/title>/, `<title>${safeAmi} t’attend en jeu — LYON ARCADE</title>`);
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.send(html);
});

// IMPORTANT : la carte OSM est servie EN PRIORITÉ depuis client/public (là où
// `node tools/fetch-osm.mjs` l'écrit), pas depuis le build. Ainsi, régénérer
// l'OSM prend effet tout de suite (au prochain redémarrage), sans avoir à
// relancer un build complet — sinon on continue de servir l'ancienne carte.
app.get('/lyon-osm.json', (req, res) => {
  const distOsm = path.join(distDir, 'lyon-osm.json');
  const file = fs.existsSync(publicOsm) ? publicOsm : distOsm;
  // La carte change peu : une heure de cache évite 3 Mo à chaque visite,
  // tout en laissant les mises à jour OSM se propager rapidement.
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
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
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else if (filePath.endsWith('lyon-osm.json')) {
        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      } else {
        // Les fichiers Vite portent leur hash : ils sont immuables et peuvent
        // être gardés un an sans empêcher le prochain déploiement.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  // Repli sur client/public : permet de déposer des fichiers (ex. panoramas
  // /pano/*.jpg) directement sur le VPS, servis sans rebuild.
  app.use(express.static(path.join(__dirname, '..', '..', 'client', 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=86400'),
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
