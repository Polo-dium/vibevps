// Synthèse vocale des PNJ avec Piper (rhasspy/piper, CPU, hors ligne).
// Binaire et voix françaises dans server/data/piper/ (gitignoré), installés
// en tâche de fond au premier démarrage par tools/install-piper.mjs
// (PIPER_AUTO_INSTALL=0 pour s'en passer). Sans Piper, le client retombe
// sur speechSynthesis du navigateur.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const PIPER_DIR = process.env.PIPER_DIR || path.join(here, '..', 'data', 'piper');
const PIPER_BIN = process.env.PIPER_BIN || path.join(PIPER_DIR, 'piper', 'piper');
const VOICES_DIR = path.join(PIPER_DIR, 'voices');
const CACHE_DIR = path.join(here, '..', 'data', 'tts-cache');
const CACHE_MAX = 600; // fichiers WAV gardés (≈ 100 Mo au pire)

// Voix par PNJ : modèle Piper, locuteur (modèles multi-voix), débit
export const VOICES = {
  patron: { model: 'fr_FR-tom-medium', lengthScale: 1.05 },
  patronne: { model: 'fr_FR-siwis-medium', lengthScale: 1.0 },
  marchand: { model: 'fr_FR-upmc-medium', speaker: 1, lengthScale: 0.92 },
  bouquiniste: { model: 'fr_FR-gilles-low', lengthScale: 1.08 },
};
export const VOICE_MODELS = [...new Set(Object.values(VOICES).map((v) => v.model))];

const modelPath = (m) => path.join(VOICES_DIR, `${m}.onnx`);

export function ttsAvailable(voice) {
  if (!fs.existsSync(PIPER_BIN)) return false;
  const v = VOICES[voice];
  return voice ? Boolean(v && fs.existsSync(modelPath(v.model))) : VOICE_MODELS.some((m) => fs.existsSync(modelPath(m)));
}

// Seules les répliques produites par le serveur sont synthétisables : le
// dialogue enregistre (id → texte, voix), le client demande /api/tts/:id.
const pending = new Map(); // id → { text, voice, t }
export function registerLine(text, voice) {
  if (!ttsAvailable(voice)) return null;
  const id = crypto.createHash('sha1').update(voice + '\n' + text).digest('hex').slice(0, 20);
  pending.set(id, { text, voice, t: Date.now() });
  if (pending.size > 400) {
    for (const [k, p] of pending) if (Date.now() - p.t > 30 * 60_000) pending.delete(k);
  }
  return id;
}

// Un seul Piper à la fois : le VPS sert aussi le jeu, pas de pic CPU
let queue = Promise.resolve();
const inflight = new Map(); // id → promesse du fichier

export function ttsFile(id) {
  if (!/^[0-9a-f]{20}$/.test(id)) return Promise.resolve(null);
  const file = path.join(CACHE_DIR, `${id}.wav`);
  if (fs.existsSync(file)) return Promise.resolve(file);
  const line = pending.get(id);
  if (!line) return Promise.resolve(null);
  if (inflight.has(id)) return inflight.get(id);
  const job = queue.then(() => runPiper(line.text, VOICES[line.voice], file)).finally(() => inflight.delete(id));
  queue = job.catch(() => {});
  inflight.set(id, job);
  return job;
}

function runPiper(text, voice, file) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmp = file + '.part';
  const args = ['--model', modelPath(voice.model), '--output_file', tmp, '--quiet'];
  if (voice.speaker != null) args.push('--speaker', String(voice.speaker));
  if (voice.lengthScale) args.push('--length_scale', String(voice.lengthScale));
  args.push('--sentence_silence', '0.15');
  return new Promise((resolve, reject) => {
    const p = spawn(PIPER_BIN, args, { cwd: ROOT, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 20_000);
    p.stderr.on('data', (d) => { err = (err + d).slice(-500); });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 44) {
        fs.renameSync(tmp, file);
        trimCache();
        resolve(file);
      } else {
        fs.rmSync(tmp, { force: true });
        reject(new Error(`piper a échoué (code ${code}) ${err.trim()}`));
      }
    });
    // Piper lit une phrase par ligne : tout sur une seule ligne
    p.stdin.end(text.replace(/\s+/g, ' ').trim() + '\n');
  });
}

let trimCount = 0;
function trimCache() {
  if (++trimCount % 25) return;
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.wav'))
      .map((f) => ({ f, t: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(CACHE_MAX)) fs.rmSync(path.join(CACHE_DIR, f), { force: true });
  } catch { /* cache best-effort */ }
}

// Installation automatique en arrière-plan (binaire + voix, ~150 Mo)
export function startPiperAutoInstall() {
  if (process.env.PIPER_AUTO_INSTALL === '0') return;
  if (fs.existsSync(PIPER_BIN) && VOICE_MODELS.every((m) => fs.existsSync(modelPath(m)))) return;
  const script = path.join(ROOT, 'tools', 'install-piper.mjs');
  if (!fs.existsSync(script)) return;
  console.log('Piper : installation des voix en arrière-plan…');
  const p = spawn(process.execPath, [script, PIPER_DIR, ...VOICE_MODELS], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => process.stdout.write('[piper] ' + d));
  p.stderr.on('data', (d) => process.stderr.write('[piper] ' + d));
  p.on('close', (code) => console.log(code === 0
    ? 'Piper : prêt, les PNJ ont leur voix.'
    : `Piper : installation échouée (code ${code}), voix du navigateur en repli.`));
}
