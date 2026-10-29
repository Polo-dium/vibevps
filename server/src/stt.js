// Reconnaissance vocale (whisper.cpp, CPU, hors ligne) pour parler aux PNJ
// au micro. Compilé dans server/data/whisper/ par tools/install-whisper.mjs,
// lancé en tâche de fond au démarrage si git/cmake/g++ sont présents
// (WHISPER_AUTO_INSTALL=0 pour couper). Le client envoie un WAV 16 kHz mono.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const DIR = process.env.WHISPER_DIR || path.join(here, '..', 'data', 'whisper');
const BIN = process.env.WHISPER_BIN || path.join(DIR, 'whisper.cpp', 'build', 'bin', 'whisper-cli');
const MODEL_NAME = process.env.WHISPER_MODEL || 'small-q5_1';
const MODEL = path.join(DIR, 'models', `ggml-${MODEL_NAME}.bin`);
const TMP = path.join(here, '..', 'data', 'stt-tmp');
// Une transcription courte à la fois : tous les cœurs (un laissé au jeu
// à partir de 4), WHISPER_THREADS pour forcer
const CORES = os.cpus().length;
const THREADS = String(process.env.WHISPER_THREADS || Math.max(1, CORES >= 4 ? CORES - 1 : CORES));
// Vocabulaire du jeu : aide whisper à écrire « Fourvière », pas « four vierge »
const PROMPT = 'Salut gone ! Bellecour, Fourvière, la Croix-Rousse, Saint-Jean, la Saône, le Rhône, '
  + 'un bouchon lyonnais, une quenelle, Guignol, Gnafron, une traboule, la ficelle.';

export function sttAvailable() {
  return fs.existsSync(BIN) && fs.existsSync(MODEL);
}

// Hallucinations classiques de whisper sur du silence ou du bruit
const JUNK = [/sous-titr/i, /amara\.org/i, /merci d'avoir regardé/i, /abonnez-vous/i];

let queue = Promise.resolve();
export function transcribe(wav) {
  const job = queue.then(() => runWhisper(wav));
  queue = job.catch(() => {});
  return job;
}

function runWhisper(wav) {
  fs.mkdirSync(TMP, { recursive: true });
  const file = path.join(TMP, crypto.randomUUID() + '.wav');
  fs.writeFileSync(file, wav);
  const args = ['-m', MODEL, '-f', file, '-l', 'fr', '-nt', '-np', '-t', THREADS, '--prompt', PROMPT];
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 30_000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-400); });
    p.on('error', (e) => { clearTimeout(timer); fs.rmSync(file, { force: true }); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(file, { force: true });
      if (code !== 0) return reject(new Error(`whisper a échoué (code ${code}) ${err.trim()}`));
      let text = out.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
      if (JUNK.some((re) => re.test(text))) text = '';
      resolve(text.slice(0, 240));
    });
  });
}

// En-tête WAV PCM 16 bits mono, 16 kHz, 15 s max
export function validWav(buf) {
  return Buffer.isBuffer(buf) && buf.length > 44 && buf.length <= 16000 * 2 * 15 + 44
    && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE'
    && buf.readUInt16LE(22) === 1 && buf.readUInt32LE(24) === 16000 && buf.readUInt16LE(34) === 16;
}

export function startWhisperAutoInstall() {
  if (process.env.WHISPER_AUTO_INSTALL === '0' || sttAvailable()) return;
  const script = path.join(ROOT, 'tools', 'install-whisper.mjs');
  try {
    execFileSync('sh', ['-c', 'command -v git && command -v cmake && command -v c++'], { stdio: 'ignore' });
  } catch {
    console.log('Micro des PNJ : whisper absent — installe « build-essential cmake git » puis relance le serveur.');
    return;
  }
  console.log('whisper.cpp : compilation et modèle en arrière-plan…');
  const p = spawn(process.execPath, [script, DIR, MODEL_NAME], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write('[whisper] ' + d));
  p.stderr.on('data', (d) => process.stderr.write('[whisper] ' + d));
  p.on('close', (code) => console.log(code === 0
    ? 'whisper.cpp : prêt, on peut parler aux PNJ au micro.'
    : `whisper.cpp : installation échouée (code ${code}).`));
}
