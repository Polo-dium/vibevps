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

// Accès bas niveau pour le séquenceur musical (music.js) : même contexte,
// même master — la musique suit le volume général du jeu.
export function getAudioGraph() {
  ensure();
  return { ctx, master };
}

// Pluie : boucle de bruit filtré persistante, dont seul le gain bouge —
// zéro allocation par frame, montée/retombée douces avec l'averse.
let rainNodes = null;
function ensureRain() {
  if (rainNodes) return rainNodes;
  ensure();
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  src.playbackRate.value = 0.55;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 850;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(filter).connect(g).connect(master);
  src.start();
  rainNodes = { g };
  return rainNodes;
}

export const audio = {
  // Niveau de pluie 0..1 (voir world/weather.js)
  // (bruit de pluie RETIRÉ à la demande de Polo, 13/11/2026 : la pluie reste
  // visible, elle ne s'entend plus — l'appel est gardé pour weather.js)
  rain() {
    if (rainNodes && ctx) rainNodes.g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  },
  // Pas : intensité 0..1 selon la vitesse
  footstep(intensity = 1) {
    if (!ctx) return;
    noise(0.07, { freq: 320 + Math.random() * 180, gain: 0.07 + 0.09 * intensity });
  },

  // VOIX DES ARMES de l'arène : chaque arme a son claquement (aigu sec),
  // son corps (grave) et sa queue (résonance). true = son joué.
  //  mp5 : 9 mm sec et court · m4 : claquant · m16 : plus plein, plus long
  //  famas : nerveux, métallique · kar98k : détonation lourde + verrou
  // `vol` < 1 : tir d'un AUTRE combattant, atténué par la distance
  // ('generic' = toute arme sans voix propre, entendue de loin)
  shotOf(id, vol = 1) {
    if (!ctx) return false;
    const S = {
      mp5: { crack: [2100, 0.05, 0.26], body: [240, 95, 0.06, 0.16], tail: [900, 0.09, 0.1], click: 3200 },
      m4: { crack: [2600, 0.06, 0.36], body: [170, 60, 0.09, 0.22], tail: [600, 0.16, 0.2], click: 2800 },
      m16: { crack: [2200, 0.07, 0.36], body: [150, 52, 0.11, 0.24], tail: [480, 0.22, 0.24], click: 2500 },
      famas: { crack: [3000, 0.05, 0.34], body: [190, 70, 0.07, 0.2], tail: [750, 0.12, 0.16], click: 3600 },
      kar98k: { crack: [1500, 0.12, 0.5], body: [110, 36, 0.3, 0.34], tail: [320, 0.5, 0.42], click: 1900 },
      generic: { crack: [1900, 0.07, 0.32], body: [140, 55, 0.09, 0.22], tail: [520, 0.18, 0.2], click: 2400 },
    }[id === 'kar98ks' ? 'kar98k' : id];
    if (!S) return false;
    // de loin, l'aigu se perd avant le grave
    noise(S.crack[1], { type: 'highpass', freq: S.crack[0], gain: S.crack[2] * vol * vol });
    tone(S.body[0], S.body[2], { type: 'square', gain: S.body[3] * vol, slideTo: S.body[1] });
    noise(S.tail[1], { type: 'lowpass', freq: S.tail[0], gain: S.tail[2] * vol, at: 0.012 });
    if (vol < 1) return true;
    tone(S.click, 0.018, { type: 'sine', gain: 0.08 });
    if (id === 'kar98k' || id === 'kar98ks') {
      // verrou : levée, recul, poussée, verrouillage
      for (const [at, f] of [[0.42, 1500], [0.56, 900], [0.78, 1100], [0.92, 1900]]) {
        tone(f, 0.035, { type: 'square', gain: 0.09, at });
        noise(0.04, { type: 'highpass', freq: 2200, gain: 0.07, at: at + 0.01 });
      }
    }
    return true;
  },
  // Une cartouche poussée dans le magasin (rechargement balle par balle)
  roundIn() {
    if (!ctx) return;
    tone(1250, 0.03, { type: 'square', gain: 0.09 });
    noise(0.05, { type: 'highpass', freq: 1800, gain: 0.08, at: 0.02 });
  },
  // Coups de mêlée : sifflement de la lame (bruit filtré qui glisse) + tintement
  swingOf(id) {
    if (!ctx) return false;
    const S = { epee: [0.26, 700, 0.2, 1900], dagues: [0.12, 1500, 0.12, 2900], lance: [0.3, 450, 0.2, 1300] }[id];
    if (!S) return false;
    noise(S[0], { type: 'bandpass', freq: S[1], q: 2.5, gain: S[2] });
    noise(S[0] * 0.6, { type: 'bandpass', freq: S[1] * 2.2, q: 3, gain: S[2] * 0.6, at: S[0] * 0.35 });
    tone(S[3], 0.12, { type: 'triangle', gain: 0.035, at: S[0] * 0.5, slideTo: S[3] * 0.92 });
    return true;
  },
  // Lame qui touche : choc mat + acier qui sonne
  bladeHit() {
    if (!ctx) return;
    noise(0.07, { type: 'lowpass', freq: 500, gain: 0.3 });
    tone(2300, 0.22, { type: 'triangle', gain: 0.07, slideTo: 2150 });
    tone(3400, 0.14, { type: 'sine', gain: 0.04 });
  },
  gunshot() {
    if (!ctx) return;
    noise(0.1, { type: 'highpass', freq: 700, gain: 0.3 });
    tone(140, 0.09, { type: 'square', gain: 0.22, slideTo: 55 });
    tone(2400, 0.02, { type: 'sine', gain: 0.1 });
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

  // Touche au corps : « tk » mat et sec. À la tête : le casque sonne
  // (deux partiels métalliques, bien distincts du corps).
  hitmarker(headshot = false) {
    if (!ctx) return;
    if (headshot) {
      tone(2640, 0.16, { type: 'triangle', gain: 0.13 });
      tone(3960, 0.11, { type: 'sine', gain: 0.07, at: 0.005 });
      noise(0.025, { type: 'highpass', freq: 3000, gain: 0.08 });
    } else {
      tone(880, 0.035, { type: 'triangle', gain: 0.12, slideTo: 520 });
      noise(0.02, { type: 'bandpass', freq: 1400, q: 2, gain: 0.07 });
    }
  },
  // Élimination confirmée : coup sourd + deux notes qui montent. D'une balle
  // dans la tête : claquement, cloche aiguë qui tient, petite octave au-dessus.
  kill(headshot = false) {
    if (!ctx) return;
    if (headshot) {
      noise(0.05, { type: 'highpass', freq: 2200, gain: 0.22 });
      tone(170, 0.14, { type: 'sine', gain: 0.26, slideTo: 60 });
      tone(3136, 0.45, { type: 'triangle', gain: 0.15, at: 0.03 });
      tone(4186, 0.3, { type: 'sine', gain: 0.08, at: 0.11 });
    } else {
      tone(190, 0.16, { type: 'sine', gain: 0.3, slideTo: 62 });
      noise(0.07, { type: 'lowpass', freq: 600, gain: 0.2 });
      tone(660, 0.08, { type: 'triangle', gain: 0.12, at: 0.07 });
      tone(990, 0.14, { type: 'triangle', gain: 0.12, at: 0.15 });
    }
  },

  // Coup de tonnerre : craquement sec puis long grondement grave
  thunder() {
    ensure();
    noise(0.1, { type: 'highpass', freq: 1800, gain: 0.55 });
    noise(0.5, { type: 'lowpass', freq: 420, gain: 0.4, at: 0.04 });
    noise(1.8, { type: 'lowpass', freq: 110, gain: 0.6, at: 0.12 });
    noise(1.2, { type: 'lowpass', freq: 180, gain: 0.25, at: 0.9 });
  },

  // Explosion (bazooka) : souffle grave + débris
  // CRI de douleur (mort d'un combattant) : voix synthétisée — une source en
  // dents de scie (cordes vocales) dont la hauteur monte puis retombe, avec
  // du tremblement, filtrée par trois formants de voyelle (« a » / « o »),
  // plus un souffle rauque. 5 variantes (hauteur, durée, voyelle) ; `vol`
  // 0..1 selon la distance.
  scream(vol = 1, variant = 0) {
    ensure();
    const V = [
      { f: 185, peak: 1.5, end: 0.6, dur: 0.55, fm: [760, 1180, 2600] },
      { f: 150, peak: 1.35, end: 0.55, dur: 0.75, fm: [640, 1050, 2450] },
      { f: 230, peak: 1.6, end: 0.7, dur: 0.42, fm: [820, 1300, 2800] },
      { f: 165, peak: 1.25, end: 0.5, dur: 0.9, fm: [560, 900, 2400] },
      { f: 205, peak: 1.7, end: 0.65, dur: 0.5, fm: [700, 1500, 2700] },
    ][Math.abs(variant) % 5];
    const t = ctx.currentTime, d = V.dur;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(V.f, t);
    osc.frequency.linearRampToValueAtTime(V.f * V.peak, t + d * 0.18);
    osc.frequency.exponentialRampToValueAtTime(V.f * V.end, t + d);
    // tremblement de la voix (de plus en plus marqué)
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 9 + (variant % 3) * 2;
    lfoG.gain.setValueAtTime(3, t);
    lfoG.gain.linearRampToValueAtTime(16, t + d);
    lfo.connect(lfoG).connect(osc.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.04);
    env.gain.setValueAtTime(0.5 * vol, t + d * 0.45);
    env.gain.exponentialRampToValueAtTime(0.0001, t + d);
    V.fm.forEach((fq, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(fq, t);
      bp.frequency.linearRampToValueAtTime(fq * 0.82, t + d); // la bouche se referme
      bp.Q.value = 7 - i;
      const g = ctx.createGain();
      g.gain.value = [1, 0.7, 0.3][i];
      osc.connect(bp).connect(g).connect(env);
    });
    env.connect(master);
    osc.start(t); lfo.start(t);
    osc.stop(t + d + 0.05); lfo.stop(t + d + 0.05);
    noise(d * 0.8, { type: 'bandpass', freq: 1400, q: 0.8, gain: 0.07 * vol });
  },
  explosion() {
    ensure();
    noise(0.15, { type: 'lowpass', freq: 900, gain: 0.5 });
    noise(0.8, { type: 'lowpass', freq: 160, gain: 0.55, at: 0.03 });
    noise(0.25, { type: 'highpass', freq: 1200, gain: 0.2, at: 0.1 });
  },

  // Coup de marteau : choc mat
  thud() {
    ensure();
    tone(120, 0.09, { type: 'square', gain: 0.25 });
    noise(0.08, { type: 'lowpass', freq: 500, gain: 0.3 });
  },

  // Fusil à pompe : détonation large + réarmement clac-clac
  shotgun() {
    ensure();
    noise(0.14, { type: 'lowpass', freq: 1400, gain: 0.45 });
    tone(90, 0.12, { type: 'square', gain: 0.28, slideTo: 40 });
    tone(750, 0.04, { type: 'square', gain: 0.1, at: 0.42 });
    tone(950, 0.04, { type: 'square', gain: 0.1, at: 0.55 });
  },

  // Départ de roquette : whoosh soufflé
  rocket() {
    ensure();
    noise(0.5, { type: 'bandpass', freq: 900, q: 0.7, gain: 0.35 });
    tone(220, 0.4, { type: 'sawtooth', gain: 0.12, slideTo: 60 });
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

  // Moteurs persistants. Le Mirage mélange souffle large, corps grave,
  // sifflement discret et petits craquements de postcombustion.
  _engine: null,
  engineStart(kind = 'car') {
    ensure();
    if (this._engine?.kind === kind) return;
    if (this._engine) this.engineStop();
    if (kind === 'jet') {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 720;
      filter.Q.value = 0.28;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.038, ctx.currentTime + 0.35);
      src.connect(filter).connect(g).connect(master);

      const bodySrc = ctx.createBufferSource();
      bodySrc.buffer = noiseBuffer;
      bodySrc.loop = true;
      bodySrc.playbackRate.value = 0.52;
      const bodyFilter = ctx.createBiquadFilter();
      bodyFilter.type = 'lowpass';
      bodyFilter.frequency.value = 180;
      bodyFilter.Q.value = 0.65;
      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0.0001, ctx.currentTime);
      bodyGain.gain.exponentialRampToValueAtTime(0.024, ctx.currentTime + 0.4);
      bodySrc.connect(bodyFilter).connect(bodyGain).connect(master);

      const whine = ctx.createOscillator();
      whine.type = 'triangle';
      whine.frequency.value = 170;
      const whineGain = ctx.createGain();
      whineGain.gain.value = 0.004;
      whine.connect(whineGain).connect(master);

      const rumble = ctx.createOscillator();
      rumble.type = 'triangle';
      rumble.frequency.value = 36;
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0.032;
      rumble.connect(rumbleGain).connect(master);
      src.start();
      bodySrc.start();
      whine.start();
      rumble.start();
      this._engine = {
        kind, src, filter, g, bodySrc, bodyFilter, bodyGain,
        osc: whine, osc2: rumble, whineGain, rumbleGain,
        nextCrackle: ctx.currentTime + 0.25,
      };
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = kind === 'prop' ? 42 : 55;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = kind === 'prop' ? 21 : 28;
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
    this._engine = { kind, osc, osc2, g, filter };
  },
  engineUpdate(k, throttle = k) { // k = vitesse, throttle = gaz, normalisés 0..1
    if (!this._engine || !ctx) return;
    k = Math.max(0, Math.min(1, k));
    if (this._engine.kind === 'jet') {
      const power = Math.max(0, Math.min(1, Number(throttle) || 0));
      this._engine.filter.frequency.setTargetAtTime(650 + k * 650 + power * 900, ctx.currentTime, 0.12);
      this._engine.g.gain.setTargetAtTime(0.032 + k * 0.015 + power * 0.065, ctx.currentTime, 0.12);
      this._engine.bodyFilter.frequency.setTargetAtTime(155 + power * 210, ctx.currentTime, 0.14);
      this._engine.bodyGain.gain.setTargetAtTime(0.024 + power * 0.039, ctx.currentTime, 0.14);
      this._engine.osc.frequency.setTargetAtTime(170 + k * 380 + power * 100, ctx.currentTime, 0.1);
      this._engine.whineGain.gain.setTargetAtTime(0.004 + power * 0.014, ctx.currentTime, 0.12);
      this._engine.osc2.frequency.setTargetAtTime(36 + k * 18 + power * 12, ctx.currentTime, 0.12);
      this._engine.rumbleGain.gain.setTargetAtTime(0.032 + power * 0.025, ctx.currentTime, 0.12);
      if (power > 0.18 && ctx.currentTime >= this._engine.nextCrackle) {
        noise(0.025 + Math.random() * 0.045, {
          type: 'bandpass', freq: 300 + Math.random() * 900, q: 0.8,
          gain: 0.012 + power * 0.026,
        });
        tone(50 + Math.random() * 30, 0.035, {
          type: 'square', gain: 0.005 + power * 0.008, slideTo: 34,
        });
        this._engine.nextCrackle = ctx.currentTime + 0.08 + Math.random() * (0.28 - power * 0.15);
      }
      return;
    }
    const f = this._engine.kind === 'prop' ? 38 + k * 220 : 45 + k * 130;
    this._engine.osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.08);
    this._engine.osc2.frequency.setTargetAtTime(f / 2, ctx.currentTime, 0.08);
    this._engine.g.gain.setTargetAtTime(
      this._engine.kind === 'prop' ? 0.045 + k * 0.085 : 0.05 + k * 0.06,
      ctx.currentTime,
      0.1
    );
  },
  engineStop() {
    if (!this._engine || !ctx) return;
    const { src, bodySrc, osc, osc2, g, bodyGain, whineGain, rumbleGain } = this._engine;
    this._engine = null;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    whineGain?.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    rumbleGain?.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    bodyGain?.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
    src?.stop(ctx.currentTime + 0.3);
    bodySrc?.stop(ctx.currentTime + 0.3);
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
