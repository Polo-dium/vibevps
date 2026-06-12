// Audio 100 % procédural : WebAudio pour les bruitages, synthèse vocale pour
// les annonces et les PNJ. Aucun fichier audio à charger.

let ctx = null;
let master = null;
let noiseBuffer = null;
let frVoice = null;

function ensure() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

// Le navigateur exige un geste utilisateur pour démarrer l'audio
function unlock() {
  ensure();
  if (ctx.state === 'suspended') ctx.resume();
  if ('speechSynthesis' in window) pickVoice();
}
window.addEventListener('pointerdown', unlock, { once: false });
window.addEventListener('keydown', unlock, { once: false });

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  frVoice = voices.find((v) => v.lang?.toLowerCase().startsWith('fr')) ?? null;
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = pickVoice;
}

function noise(duration, { type = 'lowpass', freq = 1000, q = 1, gain = 0.2, at = 0 } = {}) {
  ensure();
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter).connect(g).connect(master);
  src.start(t);
  src.stop(t + duration + 0.05);
}

function tone(freq, duration, { type = 'sine', gain = 0.15, at = 0, slideTo = null } = {}) {
  ensure();
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

export const audio = {
  // Pas : intensité 0..1 selon la vitesse
  footstep(intensity = 1) {
    if (!ctx) return;
    noise(0.07, { freq: 320 + Math.random() * 180, gain: 0.07 + 0.09 * intensity });
  },

  gunshot() {
    if (!ctx) return;
    noise(0.1, { type: 'highpass', freq: 700, gain: 0.3 });
    tone(140, 0.09, { type: 'square', gain: 0.22, slideTo: 55 });
    tone(2400, 0.02, { type: 'sine', gain: 0.1 });
  },

  // Douille qui tinte au sol (appelé au rebond visuel)
  shellBounce() {
    if (!ctx) return;
    const f = 3800 + Math.random() * 1600;
    tone(f, 0.05, { type: 'triangle', gain: 0.06 });
    tone(f * 1.3, 0.04, { type: 'triangle', gain: 0.04, at: 0.06 });
  },

  reload() {
    if (!ctx) return;
    // chargeur retiré → inséré → culasse
    tone(900, 0.04, { type: 'square', gain: 0.1 });
    noise(0.08, { freq: 500, gain: 0.1, at: 0.05 });
    tone(700, 0.05, { type: 'square', gain: 0.12, at: 0.9 });
    tone(1100, 0.04, { type: 'square', gain: 0.12, at: 1.25 });
    noise(0.06, { type: 'highpass', freq: 1500, gain: 0.12, at: 1.3 });
  },

  hitmarker() {
    if (!ctx) return;
    tone(1300, 0.04, { type: 'sine', gain: 0.1 });
  },

  // Spray de peinture : chuintement en boucle
  _hiss: null,
  hissStart() {
    ensure();
    if (this._hiss) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.06);
    src.connect(filter).connect(g).connect(master);
    src.start();
    this._hiss = { src, g };
  },
  hissStop() {
    if (!this._hiss || !ctx) return;
    const { src, g } = this._hiss;
    this._hiss = null;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    src.stop(ctx.currentTime + 0.15);
  },

  // Annonceur (KO, DOUBLE KILL…) : voix grave et lente
  announce(text) {
    this.speak(text, { pitch: 0.4, rate: 0.85, volume: 1 });
  },

  // Voix de PNJ
  npcSay(text, { hurt = false } = {}) {
    this.speak(text, {
      pitch: hurt ? 1.5 : 0.9 + Math.random() * 0.4,
      rate: hurt ? 1.3 : 1.0,
      volume: 0.8,
    });
  },

  speak(text, { pitch = 1, rate = 1, volume = 1 } = {}) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    if (frVoice) u.voice = frVoice;
    u.pitch = pitch;
    u.rate = rate;
    u.volume = volume;
    speechSynthesis.speak(u);
  },
};
