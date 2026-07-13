import { getAudioGraph } from './audio.js';

// Musique 100 % procédurale (zéro asset, zéro requête) : un petit
// séquenceur WebAudio joue des boucles de 16 pas — basse, mélodie, batterie.
// Coût quasi nul : quelques oscillateurs à durée de vie courte, programmés
// en avance ; une source quasi inaudible (volume < 1 %) ne programme RIEN.
// Utilisé par : les bars des quais, l'autoradio des décapotables, et
// l'enceinte portable des joueurs (locale + distante via le champ `mus`).

// Vrais enregistrements (facultatifs) : déposer le fichier tel quel dans
// client/public/music/ sur le VPS — servi sans rebuild, exactement comme
// /pano/fourviere.jpg. Tant que le fichier n'existe pas, la piste échoue
// silencieusement (juste un avertissement console) : aucun risque de casser
// le jeu si le morceau n'a pas encore été déposé. N'utiliser que des
// enregistrements confirmés domaine public / CC0 (Wikimedia Commons,
// Musopen…) — la partition d'une œuvre ancienne est libre, mais un
// enregistrement précis a ses propres droits sauf mention contraire.
const REAL_TRACKS = {
  // La fin de l'enregistrement contient sept secondes dont Polo ne veut pas :
  // la boucle repart avant cette portion, sans réencoder ni dégrader le MP3.
  4: { nom: 'Clair de Lune (Debussy)', file: 'clair-de-lune.mp3', endTrim: 7 },
};

export const TRACKS = [
  { id: 1, nom: 'Funk 70s' },
  { id: 2, nom: 'Disco 80s' },
  { id: 3, nom: 'Boom-bap 90s' },
  { id: 4, nom: REAL_TRACKS[4].nom },
];

// Notes en demi-tons MIDI (69 = la 440). `null` = silence.
// k/s/h : kick, caisse claire, charley sur 16 pas.
const PATTERNS = {
  1: { // funk 70s : basse syncopée, clavinet et batterie légèrement swing
    bpm: 108, swing: 0.11,
    bassType: 'sawtooth', bassGain: 0.105, bassCutoff: 620,
    bass: [40, null, 40, 43, null, 45, 47, null, 40, 40, null, 43, 45, null, 38, 39],
    leadType: 'square', leadGain: 0.035, leadCutoff: 1900,
    lead: [64, null, 67, null, 71, 69, null, 67, 64, null, 62, 64, null, 67, 69, null],
    chordType: 'triangle', chordGain: 0.018, chordDur: 2.7,
    chords: [[52, 56, 59, 62], null, null, null, [57, 61, 64, 67], null, null, null,
      [52, 56, 59, 62], null, null, null, [50, 54, 57, 60], null, null, null],
    kick: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    ghost: [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    hat: [1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1],
    openHat: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1],
  },
  2: { // disco 80s : quatre au sol, charley à contretemps et cordes
    bpm: 122,
    bassType: 'sawtooth', bassGain: 0.095, bassCutoff: 720,
    bass: [33, 45, 40, 45, 36, 48, 40, 48, 38, 50, 41, 50, 36, 48, 43, 47],
    leadType: 'triangle', leadGain: 0.032, leadCutoff: 2600,
    lead: [69, null, 72, null, 76, null, 72, 74, 67, null, 71, null, 74, null, 71, 72],
    chordType: 'sawtooth', chordGain: 0.012, chordDur: 1.35, chordCutoff: 1450,
    chords: [null, null, [57, 60, 64], null, null, null, [60, 64, 67], null,
      null, null, [55, 59, 62], null, null, null, [52, 55, 59], null],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    clap: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    openHat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
  },
  3: { // boom-bap 90s : caisse claire lourde, accords jazzy et petits rolls
    bpm: 94, swing: 0.08,
    bassType: 'triangle', bassGain: 0.13, bassCutoff: 480,
    bass: [38, null, null, 38, null, 41, null, null, 36, null, 36, null, null, 33, null, 36],
    leadType: 'sine', leadGain: 0.038,
    lead: [62, null, null, 65, null, null, 69, null, 60, null, null, 64, null, 67, null, null],
    chordType: 'triangle', chordGain: 0.022, chordDur: 3.2,
    chords: [[50, 53, 57, 60], null, null, null, null, null, null, null,
      [48, 52, 55, 59], null, null, null, [45, 48, 52, 55], null, null, null],
    kick: [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    ghost: [0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1],
    openHat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
  },
};

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Une source de musique indépendante (un bar, une voiture, une enceinte).
export function createMusicSource() {
  let graph = null; // { ctx, master } — créé au premier start (geste requis)
  let out = null; // gain de la source (volume par distance)
  let noiseBuf = null;
  let trackId = 0;
  let timer = null;
  let step = 0;
  let nextTime = 0;
  let volume = 0.4;
  let realAudio = null; // <audio> réutilisé pour les vrais enregistrements

  function ensureGraph() {
    if (graph) return;
    graph = getAudioGraph();
    out = graph.ctx.createGain();
    out.gain.value = volume;
    out.connect(graph.master);
    noiseBuf = graph.ctx.createBuffer(1, graph.ctx.sampleRate / 2, graph.ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function note(freq, t, dur, type, gain, { cutoff = 0, attack = 0.006 } = {}) {
    const { ctx } = graph;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    if (cutoff) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      filter.Q.value = 0.8;
      osc.connect(filter).connect(g).connect(out);
    } else {
      osc.connect(g).connect(out);
    }
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  function drum(t, kind) {
    const { ctx } = graph;
    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.16);
      return;
    }
    const noiseHit = (at, freq, gain, dur) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      src.connect(f).connect(g).connect(out);
      src.start(at);
      src.stop(at + dur + 0.03);
    };
    if (kind === 'clap') {
      noiseHit(t, 1050, 0.07, 0.13);
      noiseHit(t + 0.018, 1300, 0.055, 0.11);
      noiseHit(t + 0.036, 1550, 0.04, 0.09);
      return;
    }
    if (kind === 'ghost') {
      noiseHit(t, 1800, 0.045, 0.055);
      return;
    }
    const open = kind === 'openHat';
    noiseHit(t, kind === 'snare' ? 1400 : open ? 7200 : 6500,
      kind === 'snare' ? 0.15 : open ? 0.065 : 0.045,
      kind === 'snare' ? 0.11 : open ? 0.22 : 0.045);
  }

  function scheduleStep(i, t, p, stepDur) {
    const s = i % 16;
    const playTime = t + (s % 2 ? stepDur * (p.swing ?? 0) : 0);
    const b = p.bass[s];
    if (b != null) note(midi(b), playTime, stepDur * 0.92, p.bassType, p.bassGain, { cutoff: p.bassCutoff });
    const l = p.lead[s];
    if (l != null) note(midi(l), playTime, stepDur * 0.82, p.leadType, p.leadGain, { cutoff: p.leadCutoff });
    const chord = p.chords?.[s];
    if (chord) {
      for (const n of chord) {
        note(midi(n), playTime, stepDur * (p.chordDur ?? 2), p.chordType, p.chordGain, {
          cutoff: p.chordCutoff,
          attack: 0.018,
        });
      }
    }
    if (p.kick[s]) drum(playTime, 'kick');
    if (p.snare[s]) drum(playTime, 'snare');
    if (p.clap?.[s]) drum(playTime, 'clap');
    if (p.ghost?.[s]) drum(playTime, 'ghost');
    if (p.hat[s]) drum(playTime, 'hat');
    if (p.openHat?.[s]) drum(playTime, 'openHat');
  }

  // Vrai fichier audio (facultatif) : lu via un <audio> connecté au même
  // gain `out`, donc le volume par distance s'applique pareil qu'au synthé.
  function startReal(id) {
    const t = REAL_TRACKS[id];
    ensureGraph();
    trackId = id;
    if (timer) { clearInterval(timer); timer = null; }
    if (!realAudio) {
      realAudio = new Audio(`/music/${t.file}`);
      realAudio.loop = false;
      realAudio.addEventListener('error', () => {
        console.warn(`🎵 Musique introuvable : /music/${t.file} — dépose le fichier dans client/public/music/ sur le VPS pour l'activer.`);
      });
      const loopBeforeTrimmedEnd = () => {
        const active = REAL_TRACKS[trackId];
        if (!active || !Number.isFinite(realAudio.duration)) return;
        const loopAt = Math.max(0, realAudio.duration - (active.endTrim ?? 0));
        if (realAudio.currentTime < loopAt - 0.08) return;
        realAudio.currentTime = active.loopStart ?? 0;
        realAudio.play().catch(() => {});
      };
      realAudio.addEventListener('timeupdate', loopBeforeTrimmedEnd);
      realAudio.addEventListener('ended', loopBeforeTrimmedEnd);
      // Un enregistrement réel est mastérisé bien plus bas qu'un synthé
      // (surtout un morceau doux comme du piano) : coup de boost + limiteur
      // serré pour que ça s'entende vraiment sans distordre sur les passages
      // plus forts, puis un gain de rattrapage après le limiteur pour
      // remonter le niveau moyen (le limiteur seul ne fait qu'écrêter les
      // pics, il ne rend pas le morceau plus fort). Les synthés (start())
      // ne passent pas par ce chemin.
      const boost = graph.ctx.createGain();
      boost.gain.value = t.gainBoost ?? 6.5;
      const limiter = graph.ctx.createDynamicsCompressor();
      limiter.threshold.value = -20;
      limiter.knee.value = 12;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      const makeup = graph.ctx.createGain();
      makeup.gain.value = t.makeupGain ?? 1.8;
      graph.ctx.createMediaElementSource(realAudio).connect(boost).connect(limiter).connect(makeup).connect(out);
    } else if (!realAudio.src.endsWith(t.file)) {
      realAudio.src = `/music/${t.file}`;
    }
    realAudio.currentTime = 0;
    realAudio.play().catch(() => {}); // geste utilisateur déjà garanti par l'appelant
  }

  function start(id) {
    if (REAL_TRACKS[id]) { startReal(id); return; }
    if (!PATTERNS[id]) return stop();
    realAudio?.pause(); // on bascule éventuellement d'un vrai morceau vers un synthé
    ensureGraph();
    trackId = id;
    if (timer) clearInterval(timer);
    step = 0;
    nextTime = graph.ctx.currentTime + 0.06;
    const tick = () => {
      const p = PATTERNS[trackId];
      const stepDur = 60 / p.bpm / 4; // double-croche
      // Trop loin pour être entendu : on laisse couler le temps sans rien
      // programmer (zéro oscillateur créé)
      const silent = out.gain.value < 0.008;
      while (nextTime < graph.ctx.currentTime + 0.18) {
        if (!silent) scheduleStep(step, nextTime, p, stepDur);
        step++;
        nextTime += stepDur;
      }
    };
    timer = setInterval(tick, 60);
    tick();
  }

  function stop() {
    trackId = 0;
    if (timer) { clearInterval(timer); timer = null; }
    realAudio?.pause();
  }

  function setVolume(v) {
    volume = v;
    if (out) out.gain.value = v;
  }

  return {
    start, stop, setVolume,
    get track() { return trackId; },
  };
}

// Volume selon la distance (portée ~38 m, décroissance douce)
export function gainForDistance(d, base = 0.4, range = 38) {
  const k = Math.max(0, 1 - d / range);
  return base * k * k;
}
