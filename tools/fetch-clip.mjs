#!/usr/bin/env node
// Récupère un clip du concert depuis Google Drive et le prépare pour l'écran
// géant : 640×360, 24 i/s, H.264 (.mp4) + VP9 (.webm), son retiré (le son
// vient du MP3). Déposé dans server/data/clips/ (hors git), servi en
// priorité sur client/public/clips/.
//   node tools/fetch-clip.mjs <id-ou-lien-Drive> <nom>   (ex. call-me-it)
// Le fichier Drive doit être partagé « Tous les utilisateurs disposant du lien ».
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [src, name] = process.argv.slice(2);
if (!src || !name || !/^[a-z0-9-]+$/.test(name)) {
  console.error('Usage : node tools/fetch-clip.mjs <id-ou-lien-Drive> <nom-du-clip>');
  process.exit(1);
}
const id = (src.match(/[-\w]{25,}/) ?? [src])[0];
const dir = path.join(root, 'server', 'data', 'clips');
fs.mkdirSync(dir, { recursive: true });
const raw = path.join(dir, `${name}.source.mp4`);

console.log(`Téléchargement du fichier Drive ${id}…`);
const res = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, { redirect: 'follow' });
if (!res.ok || /text\/html/.test(res.headers.get('content-type') ?? '')) {
  console.error(`Échec (${res.status}) : le fichier est-il partagé « Tous les utilisateurs disposant du lien » ?`);
  process.exit(1);
}
await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(raw));
console.log(`  ✓ ${(fs.statSync(raw).size / 1e6).toFixed(1)} Mo`);

try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch {
  fs.renameSync(raw, path.join(dir, `${name}.mp4`));
  console.log('ffmpeg absent : clip gardé tel quel (apt install -y ffmpeg pour l\'alléger).');
  process.exit(0);
}
const vf = 'scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,fps=24';
const run = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-an', '-vf', vf, ...args], { stdio: 'inherit' });
console.log('Conversion H.264…');
run(['-c:v', 'libx264', '-profile:v', 'main', '-preset', 'slow', '-crf', '27', '-movflags', '+faststart', path.join(dir, `${name}.mp4`)]);
console.log('Conversion VP9…');
run(['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '38', '-row-mt', '1', '-deadline', 'good', path.join(dir, `${name}.webm`)]);
fs.rmSync(raw);
for (const ext of ['mp4', 'webm']) {
  console.log(`  ✓ ${name}.${ext} ${(fs.statSync(path.join(dir, `${name}.${ext}`)).size / 1e6).toFixed(1)} Mo`);
}
console.log('Clip en place : il passe au prochain « Call Me It » (rechargez la page).');
