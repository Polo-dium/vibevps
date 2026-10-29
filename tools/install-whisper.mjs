#!/usr/bin/env node
// Installe whisper.cpp (reconnaissance vocale hors ligne, CPU) + un modèle.
//   node tools/install-whisper.mjs [dossier] [modèle]
// Par défaut : server/data/whisper, modèle small-q5_1 (≈ 190 Mo, bon en
// français). Compile depuis les sources : il faut git, cmake et g++
// (Ubuntu : apt install -y build-essential cmake git). Rejouable.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] || path.join(root, 'server', 'data', 'whisper'));
const model = process.argv[3] || process.env.WHISPER_MODEL || 'small-q5_1';
const TAG = 'v1.7.6';
const src = path.join(dir, 'whisper.cpp');
const bin = path.join(src, 'build', 'bin', 'whisper-cli');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

for (const tool of ['git', 'cmake', 'c++']) {
  try { execFileSync('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' }); } catch {
    console.error(`Il manque « ${tool} ». Ubuntu : apt install -y build-essential cmake git`);
    process.exit(2);
  }
}
fs.mkdirSync(path.join(dir, 'models'), { recursive: true });

// 1. sources + compilation (whisper-cli seul, en statique)
if (!fs.existsSync(bin)) {
  if (!fs.existsSync(path.join(src, 'CMakeLists.txt'))) {
    fs.rmSync(src, { recursive: true, force: true });
    console.log(`Clonage de whisper.cpp ${TAG}…`);
    run('git', ['clone', '--depth', '1', '--branch', TAG, 'https://github.com/ggml-org/whisper.cpp', src]);
  }
  console.log('Compilation (quelques minutes)…');
  run('cmake', ['-B', 'build', '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF',
    '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_EXAMPLES=ON', '-DGGML_NATIVE=ON'], { cwd: src });
  const jobs = String(Math.max(1, Math.floor(os.cpus().length / 2))); // le jeu tourne à côté
  run('cmake', ['--build', 'build', '--config', 'Release', '-j', jobs, '--target', 'whisper-cli'], { cwd: src });
}

// 2. modèle ggml
const file = path.join(dir, 'models', `ggml-${model}.bin`);
if (!fs.existsSync(file)) {
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;
  console.log(`Téléchargement du modèle ${model}…`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file + '.part'));
  fs.renameSync(file + '.part', file);
}

// 3. essai sur l'échantillon livré avec les sources
const sample = path.join(src, 'samples', 'jfk.wav');
if (fs.existsSync(sample)) {
  const out = execFileSync(bin, ['-m', file, '-f', sample, '-nt', '-np', '-t', '2']).toString().trim();
  console.log(`Essai : « ${out.slice(0, 80)} »`);
}
console.log(`whisper.cpp OK — ${file}`);
