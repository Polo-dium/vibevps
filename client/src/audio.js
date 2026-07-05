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

  // Moteur de voiture : oscillateur persistant dont la hauteur suit la vitesse
  _engine: null,
  engineStart() {
    ensure();
    if (this._engine) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 28;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.2);
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(g).connect(master);
    osc.start();
    osc2.start();
    this._engine = { osc, osc2, g };
  },
  engineUpdate(k) { // k = vitesse normalisée 0..1
    if (!this._engine || !ctx) return;
    const f = 45 + k * 130;
    this._engine.osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.08);
    this._engine.osc2.frequency.setTargetAtTime(f / 2, ctx.currentTime, 0.08);
    this._engine.g.gain.setTargetAtTime(0.05 + k * 0.06, ctx.currentTime, 0.1);
  },
  engineStop() {
    if (!this._engine || !ctx) return;
    const { osc, osc2, g } = this._engine;
    this._engine = null;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    osc.stop(ctx.currentTime + 0.3);
    osc2.stop(ctx.currentTime + 0.3);
  },

  // Jetpack : souffle de réacteur en boucle, module par la poussée
  _jet: null,
  jetStart() {
    ensure();
    if (this._jet) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(filter).connect(g).connect(master);
    src.start();
    this._jet = { src, g, filter };
  },
  jetThrust(on) {
    if (!this._jet || !ctx) return;
    this._jet.g.gain.setTargetAtTime(on ? 0.16 : 0.04, ctx.currentTime, 0.06);
    this._jet.filter.frequency.setTargetAtTime(on ? 1500 : 900, ctx.currentTime, 0.08);
  },
  jetStop() {
    if (!this._jet || !ctx) return;
    const { src, g } = this._jet;
    this._jet = null;
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
    src.stop(ctx.currentTime + 0.3);
  },

  // Klaxon deux tons, très français
  horn() {
    if (!ctx) return;
    tone(440, 0.18, { type: 'square', gain: 0.12 });
    tone(554, 0.18, { type: 'square', gain: 0.12, at: 0.02 });
  },

  // Tôle froissée (petite collision en voiture)
  crash() {
    if (!ctx) return;
    noise(0.22, { freq: 900, gain: 0.25, q: 0.6 });
    tone(90, 0.18, { type: 'square', gain: 0.14, slideTo: 45 });
  },

  // Passage de traboule : souffle grave + glissando mystérieux
  traboule() {
    if (!ctx) return;
    noise(0.35, { freq: 500, gain: 0.18 });
    tone(220, 0.4, { type: 'sine', gain: 0.1, slideTo: 660 });
    tone(880, 0.2, { type: 'triangle', gain: 0.05, at: 0.25 });
  },

  // Petite récompense (tag posé, XP gagnée) : carillon bref et satisfaisant
  reward() {
    if (!ctx) return;
    tone(880, 0.09, { type: 'sine', gain: 0.1 });
    tone(1320, 0.12, { type: 'sine', gain: 0.09, at: 0.07 });
  },

  // Passage de niveau : arpège ascendant triomphant
  levelUp() {
    if (!ctx) return;
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => {
      tone(f, 0.16, { type: 'triangle', gain: 0.12, at: i * 0.09 });
      tone(f * 2, 0.1, { type: 'sine', gain: 0.05, at: i * 0.09 });
    });
  },

  // Succès débloqué : fanfare courte
  trophy() {
    if (!ctx) return;
    tone(587, 0.12, { type: 'square', gain: 0.08 });
    tone(784, 0.12, { type: 'square', gain: 0.08, at: 0.12 });
    tone(1175, 0.3, { type: 'triangle', gain: 0.12, at: 0.24 });
  },

  // Manette tactile des bornes d'arcade
  arcadeTick() {
    if (!ctx) return;
    tone(520, 0.035, { type: 'square', gain: 0.05 });
  },
  arcadeClick(kind = 'a') {
    if (!ctx) return;
    if (kind === 'a') tone(880, 0.05, { type: 'square', gain: 0.09, slideTo: 1200 });
    else tone(660, 0.05, { type: 'square', gain: 0.09, slideTo: 420 });
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
