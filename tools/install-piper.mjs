#!/usr/bin/env node
// Installe Piper (TTS hors ligne, CPU) et des voix françaises pour les PNJ.
//   node tools/install-piper.mjs [dossier] [voix...]
// Par défaut : server/data/piper, voix listées dans server/src/tts.js.
// Lancé tout seul par le serveur au démarrage s'il manque quelque chose
// (PIPER_AUTO_INSTALL=0 pour couper). Rejouable : ne retélécharge rien.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] || path.join(root, 'server', 'data', 'piper'));
let voices = process.argv.slice(3);
if (!voices.length) voices = (await import('../server/src/tts.js')).VOICE_MODELS;

const RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/';
const ARCH = { x64: 'x86_64', arm64: 'aarch64', arm: 'armv7l' }[os.arch()];
const VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  console.log(`  ✓ ${path.basename(dest)} (${(fs.statSync(dest).size / 1e6).toFixed(1)} Mo)`);
}

fs.mkdirSync(path.join(dir, 'voices'), { recursive: true });

// 1. binaire (archive avec ses bibliothèques et espeak-ng-data)
const bin = path.join(dir, 'piper', 'piper');
if (!fs.existsSync(bin)) {
  if (process.platform !== 'linux' || !ARCH) {
    console.error(`Plateforme non gérée (${process.platform}/${os.arch()}) : installe Piper à la main et définis PIPER_BIN.`);
    process.exit(1);
  }
  console.log(`Téléchargement de Piper (${ARCH})…`);
  const tgz = path.join(dir, 'piper.tar.gz');
  await download(`${RELEASE}piper_linux_${ARCH}.tar.gz`, tgz);
  execFileSync('tar', ['xzf', tgz, '-C', dir]);
  fs.rmSync(tgz);
}

// 2. voix : fr_FR-tom-medium → fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx
for (const v of voices) {
  const m = v.match(/^(([a-z]{2})_[A-Z]{2})-(.+)-(x_low|low|medium|high)$/);
  if (!m) { console.warn(`Nom de voix invalide : ${v}`); continue; }
  const [, lang, family, name, quality] = m;
  const base = `${VOICE_BASE}${family}/${lang}/${name}/${quality}/${v}`;
  for (const ext of ['.onnx.json', '.onnx']) {
    const dest = path.join(dir, 'voices', v + ext);
    if (!fs.existsSync(dest)) await download(base + ext, dest);
  }
}

// 3. essai : une phrase avec la première voix
const test = path.join(dir, 'test.wav');
execFileSync(bin, ['--model', path.join(dir, 'voices', voices[0] + '.onnx'), '--output_file', test, '--quiet'],
  { input: 'Salut les gones, bienvenue à Lyon !\n' });
console.log(`Piper OK (${fs.statSync(test).size} octets de test) — ${voices.length} voix dans ${dir}`);
