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
  4: { nom: 'Clair de Lune (Debussy)', file: 'clair-de-lune.mp3' },
};

export const TRACKS = [
  { id: 1, nom: 'Gone Funk' },
  { id: 2, nom: 'Quenelle Wave' },
  { id: 3, nom: 'Guignol 8-bit' },
  { id: 4, nom: REAL_TRACKS[4].nom },
];

// Notes en demi-tons MIDI (69 = la 440). `null` = silence.
// k/s/h : kick, caisse claire, charley sur 16 pas.
const PATTERNS = {
  1: { // funk qui groove
    bpm: 112,
    bassType: 'square', bassGain: 0.16,
    bass: [38, null, 38, 45, null, 41, null, 38, null, 38, null, 45, 46, null, 45, 41],
    leadType: 'square', leadGain: 0.07,
    lead: [62, null, null, 65, null, 62, 69, null, null, 67, 65, null, 62, null, 60, null],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1],
  },
  2: { // synthwave mineur, plus lent
    bpm: 92,
    bassType: 'sawtooth', bassGain: 0.12,
    bass: [33, null, null, null, 36, null, null, null, 31, null, null, null, 38, null, 36, null],
    leadType: 'triangle', leadGain: 0.1,
    lead: [57, 60, 64, 60, 57, 60, 64, 67, 55, 59, 62, 59, 55, 59, 62, 66],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
  },
  3: { // chiptune speed, arcade assumée
    bpm: 140,
    bassType: 'square', bassGain: 0.13,
    bass: [45, 45, 52, 45, 43, 43, 50, 43, 41, 41, 48, 41, 43, 43, 50, 43],
    leadType: 'square', leadGain: 0.08,
    lead: [69, 72, 76, 72, 69, null, 71, 72, 74, 71, 67, null, 65, 67, 69, null],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    snare: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
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
    noiseBuf = graph.ctx.createBuffer(1, graph.ctx.sampleRate / 8, graph.ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function note(freq, t, dur, type, gain) {
    const { ctx } = graph;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(out);
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
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = kind === 'snare' ? 1400 : 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(kind === 'snare' ? 0.16 : 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'snare' ? 0.1 : 0.04));
    src.connect(f).connect(g).connect(out);
    src.start(t);
    src.stop(t + 0.12);
  }

  function scheduleStep(i, t, p, stepDur) {
    const s = i % 16;
    const b = p.bass[s];
    if (b != null) note(midi(b), t, stepDur * 0.9, p.bassType, p.bassGain);
    const l = p.lead[s];
    if (l != null) note(midi(l), t, stepDur * 0.8, p.leadType, p.leadGain);
    if (p.kick[s]) drum(t, 'kick');
    if (p.snare[s]) drum(t, 'snare');
    if (p.hat[s]) drum(t, 'hat');
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
      realAudio.loop = true;
      realAudio.addEventListener('error', () => {
        console.warn(`🎵 Musique introuvable : /music/${t.file} — dépose le fichier dans client/public/music/ sur le VPS pour l'activer.`);
      });
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
