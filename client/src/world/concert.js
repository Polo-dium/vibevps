import * as THREE from 'three';
import { ALBUM } from './album.js';
import { buildSinger, loadSingerModel } from './singer.js';
import { buildHuman } from './human.js';
import { makeRand } from './layout.js';
import { getAudioGraph } from '../audio.js';
import { detail } from '../render/detail.js';

// CONCERT PERMANENT AU THÉÂTRE DE FOURVIÈRE. La chanteuse des clips joue un
// morceau de l'album par jour, en boucle, sur une scène moderne posée sur
// le pulpitum antique : écran géant (gros plan en direct), écrans de
// paroles, faisceaux, line arrays, public dans l'orchestre.
//
// Événement partagé SANS serveur (même motif que le cycle jour/nuit) :
// le morceau du jour et la position de lecture se déduisent de Date.now(),
// tout le monde entend la même mesure au même moment, zéro trafic réseau.
// Le son ne se télécharge et ne se décode qu'à l'approche du théâtre.

const GAP = 24; // s entre deux passages : applaudissements, puis on remet ça
const DAY_MS = 86400000;
const PARIS = 3600000; // la journée change à minuit à Lyon (heure d'hiver)
const HEAR = 175; // portée du son (m)
const FULL = 38; // dans la cavea : plein volume
const SHOW = 420;
const ALBUM_DAY0 = 20754; // au-delà, tout le plateau est masqué (zéro coût)

export function concertState(now = Date.now()) {
  // Rotation ancrée au 28/10/2026 : ce jour-là, le premier titre (le clip)
  const day = Math.floor((now + PARIS) / DAY_MS) - ALBUM_DAY0;
  const track = ALBUM[((day % ALBUM.length) + ALBUM.length) % ALBUM.length];
  const tomorrow = ALBUM[(((day + 1) % ALBUM.length) + ALBUM.length) % ALBUM.length];
  const cycle = track.duration + GAP;
  const t = (((now / 1000) % cycle) + cycle) % cycle;
  return { track, tomorrow, t, playing: t < track.duration };
}

function sectionAt(track, t) {
  for (const s of track.sections) if (t >= s[0] && t < s[1]) return s;
  return null;
}

// --- Son : <audio> partagé, analyseur (voix, grosse caisse), volume ----------
function createConcertAudio() {
  let el = null, analyser = null, gain = null, freq = null, file = null;
  let applause = null;
  function ensure(track) {
    const { ctx, master } = getAudioGraph();
    if (!el) {
      el = new Audio();
      el.preload = 'auto';
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.55;
      freq = new Uint8Array(analyser.frequencyBinCount);
      gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(analyser);
      analyser.connect(gain).connect(master);
      el.addEventListener('error', () => console.warn(`🎤 Concert : /music/${file} introuvable.`));
    }
    if (file !== track.file) {
      file = track.file;
      el.src = `/music/${track.file}`;
    }
    return ctx;
  }
  // Applaudissements synthétisés (une fois) : salves de claquements filtrés
  function clap(ctx) {
    if (applause) return applause;
    const sr = ctx.sampleRate, len = sr * 3;
    const buf = ctx.createBuffer(2, len, sr);
    const rand = makeRand(5150);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let n = 0; n < 900; n++) {
        const at = Math.floor(rand() * len), dur = Math.floor(sr * (0.006 + rand() * 0.012));
        const amp = 0.15 + rand() * 0.35;
        for (let i = 0; i < dur && at + i < len; i++) d[at + i] += (rand() * 2 - 1) * amp * Math.exp(-i / (dur * 0.3));
      }
    }
    const g = ctx.createGain();
    g.gain.value = 0;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    src.connect(hp).connect(g).connect(gain);
    src.start();
    applause = g;
    return g;
  }
  let lastSync = 0, lastTry = 0;
  return {
    get ready() { return Boolean(el); },
    get element() { return el; }, // inspection (tests, ?debug)
    update(st, volume, now, preload) {
      if (volume <= 0.002) {
        if (el && !el.paused) el.pause();
        if (gain) gain.gain.value = 0;
        // À l'approche : on télécharge déjà le morceau (prêt à l'arrivée)
        if (preload) ensure(st.track);
        return;
      }
      const ctx = ensure(st.track);
      gain.gain.value = volume;
      // Salve d'applaudissements au début de la pause
      const a = clap(ctx);
      const tg = st.t - st.track.duration;
      a.gain.value = !st.playing && tg < 9 ? Math.min(1, tg * 3) * Math.max(0, 1 - tg / 9) * 0.5 : 0;
      if (!st.playing) {
        if (!el.paused) el.pause();
        return;
      }
      if (el.paused) {
        // Au plus une tentative par seconde (le navigateur peut refuser la
        // lecture tant que le joueur n'a pas cliqué)
        if (now - lastTry < 1000) return;
        lastTry = now;
        el.currentTime = st.t;
        el.play().catch(() => {});
        lastSync = now;
      } else if (now - lastSync > 1000 && !el.seeking && el.readyState >= 2) {
        lastSync = now;
        // Recalage sur l'horloge commune si on a dérivé (onglet en veille…)
        if (Math.abs(el.currentTime - st.t) > 0.35) el.currentTime = st.t;
      }
    },
    // Niveaux 0..1 : grave (grosse caisse), voix (médium), global
    levels(out) {
      if (!el || el.paused || !analyser) return false;
      analyser.getByteFrequencyData(freq);
      let bass = 0, voice = 0, all = 0;
      for (let i = 1; i <= 3; i++) bass += freq[i];
      for (let i = 6; i <= 64; i++) voice += freq[i];
      for (let i = 1; i < 160; i++) all += freq[i];
      out.bass = bass / (3 * 255);
      out.voice = voice / (59 * 255);
      out.all = all / (159 * 255);
      return true;
    },
  };
}

// --- Textures ---------------------------------------------------------------
function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  // haut du canvas = sommet du cône (la lyre) : intense, puis s'efface
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}

function trussTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.strokeRect(3, 0, 58, 64);
  g.beginPath(); g.moveTo(3, 0); g.lineTo(61, 32); g.lineTo(3, 64); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function speakerTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#141416';
  g.fillRect(0, 0, 64, 64);
  for (const [x, y, r] of [[32, 22, 14], [32, 50, 9]]) {
    const grad = g.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, '#3a3a40');
    grad.addColorStop(0.7, '#0b0b0d');
    grad.addColorStop(1, '#2a2a2e');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildConcert(ctx, P) {
  // Repère de la scène : origine au centre de l'orchestre, au niveau du
  // dallage ; z local = vers la scène (a), x local = -b
  const root = new THREE.Group();
  root.position.set(P.cx, P.y0, P.cz);
  root.rotation.y = Math.atan2(P.fx, P.fz);
  ctx.scene.add(root);
  const SY = P.stageY - P.y0; // dessus de scène (local)
  const L = (a, b, y) => new THREE.Vector3(-b, y, a);

  const black = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.55, metalness: 0.4 });

  // STRUCTURE : deux tours et une poutre en treillis (ajouré)
  const trussMat = new THREE.MeshStandardMaterial({
    color: 0x2c2d31, roughness: 0.45, metalness: 0.8, map: trussTexture(),
    alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const TOWER_B = 10.6, TOWER_A = 6.4, TOP = SY + 10.5;
  const trussBox = (w, h, d, at) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    const rep = Math.max(w, h, d) / 0.5; // un motif de treillis tous les 50 cm
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (h > w ? rep : 1)), uv.setX(i, uv.getX(i) * (w > h ? rep : 1));
    const m = new THREE.Mesh(geo, trussMat);
    m.position.copy(at);
    m.castShadow = true;
    root.add(m);
  };
  for (const s of [-1, 1]) trussBox(0.5, TOP - SY, 0.5, L(TOWER_A, s * TOWER_B, (SY + TOP) / 2));
  trussBox(2 * TOWER_B + 0.5, 0.5, 0.5, L(TOWER_A, 0, TOP));

  // ÉCRAN GÉANT (gros plan en direct) + cadre
  const SCREEN = { w: 9.2, h: 5.18, a: 8.5, y: SY + 2.4 + 2.59 };
  const rt = new THREE.WebGLRenderTarget(512, 288, { type: THREE.HalfFloatType });
  // Gros plan : un petit rendu de plus toutes les 2 images (Élevé), 4
  // (Moyen) ; au palier Bas, aucun rendu en plus — l'écran montre les paroles
  const closeEvery = detail.level === 'eleve' ? 2 : detail.level === 'moyen' ? 4 : 0;
  const screenMat = new THREE.MeshBasicMaterial({ map: rt.texture, color: new THREE.Color(0.95, 0.95, 0.95) });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), screenMat);
  screen.position.copy(L(SCREEN.a - 0.02, 0, SCREEN.y));
  screen.rotation.y = Math.PI; // face au public (-z local)
  root.add(screen);
  const screenFrame = new THREE.Mesh(new THREE.BoxGeometry(SCREEN.w + 0.4, SCREEN.h + 0.4, 0.3), black);
  screenFrame.position.copy(L(SCREEN.a + 0.17, 0, SCREEN.y));
  root.add(screenFrame);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, SCREEN.y - SCREEN.h / 2 - SY, 0.25), black);
    leg.position.copy(L(SCREEN.a + 0.2, s * 3.5, SY + (SCREEN.y - SCREEN.h / 2 - SY) / 2));
    root.add(leg);
  }

  // ÉCRANS DE PAROLES de part et d'autre
  const lyricCanvas = document.createElement('canvas');
  lyricCanvas.width = 384;
  lyricCanvas.height = 512;
  const lyricTex = new THREE.CanvasTexture(lyricCanvas);
  lyricTex.colorSpace = THREE.SRGBColorSpace;
  const lyricMat = new THREE.MeshBasicMaterial({ map: lyricTex, color: new THREE.Color(1.3, 1.3, 1.3) });
  if (!closeEvery) screenMat.map = lyricTex;

  // LE VRAI CLIP (si le morceau en a un) : <video> muette calée sur la même
  // horloge que le son, chargée seulement à l'approche
  let video = null, videoTex = null, videoFile = null, lastVideoSync = 0;
  function syncVideo(st, near, now) {
    const clip = st.track.clip;
    if (!clip || !near) {
      if (video && !video.paused) video.pause();
      return false;
    }
    if (!video) {
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      videoTex = new THREE.VideoTexture(video);
      videoTex.colorSpace = THREE.SRGBColorSpace;
    }
    if (videoFile !== clip) {
      videoFile = clip;
      // H.264 (plus léger) si le navigateur le lit, sinon VP9 (Chromium
      // libre, certains Linux)
      const h264 = video.canPlayType('video/mp4; codecs="avc1.4D401E"');
      video.src = `/clips/${clip}.${h264 ? 'mp4' : 'webm'}`;
    }
    if (!st.playing) { if (!video.paused) video.pause(); return video.readyState >= 2; }
    if (video.paused || (now - lastVideoSync > 1000 && video.readyState >= 2 && Math.abs(video.currentTime - st.t) > 0.3)) {
      if (now - lastVideoSync > 1000) {
        lastVideoSync = now;
        video.currentTime = st.t;
        video.play().catch(() => {});
      }
    }
    return video.readyState >= 2;
  }
  // Titres sans clip : visuels géométriques sur le tempo (canvas léger)
  const geoCanvas = document.createElement('canvas');
  geoCanvas.width = 384;
  geoCanvas.height = 216;
  const geoTex = new THREE.CanvasTexture(geoCanvas);
  geoTex.colorSpace = THREE.SRGBColorSpace;
  function drawGeo(st, t, pulse, energy, lvBass) {
    const g = geoCanvas.getContext('2d');
    const W = geoCanvas.width, H = geoCanvas.height;
    g.fillStyle = 'rgba(6,5,12,0.35)'; // traînées
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, H / 2);
    const n = 6 + Math.floor(energy * 6);
    for (let i = 0; i < n; i++) {
      const r = 18 + i * 14 + pulse * 10;
      g.rotate(t * 0.15 * (i % 2 ? 1 : -1) + i * 0.4);
      g.strokeStyle = i % 3 === 0 ? '#ff7a1a' : i % 3 === 1 ? '#f4efe6' : '#7ef0ff';
      g.lineWidth = 2 + pulse * 3;
      g.beginPath();
      const sides = 3 + (i % 4);
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
      }
      g.stroke();
    }
    g.restore();
    // barres au sol, façon spectre
    for (let i = 0; i < 24; i++) {
      const h = (0.15 + 0.85 * Math.abs(Math.sin(t * 3 + i * 0.7)) * (0.3 + lvBass)) * H * 0.35;
      g.fillStyle = i % 2 ? '#ff7a1a' : '#f4efe6';
      g.fillRect(8 + i * 15.6, H - h, 9, h);
    }
    g.fillStyle = '#ffffff';
    g.font = 'bold 20px sans-serif';
    g.textAlign = 'left';
    g.fillText(st.track.titre.toUpperCase(), 12, 28);
    geoTex.needsUpdate = true;
  }
  for (const s of [-1, 1]) {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4.8), lyricMat);
    scr.position.copy(L(8.0, s * 7.6, SY + 4.6));
    scr.rotation.y = Math.PI - s * 0.18;
    root.add(scr);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(3.85, 5.05, 0.2), black);
    fr.position.copy(L(8.12, s * 7.6, SY + 4.6));
    fr.rotation.y = -s * 0.18;
    root.add(fr);
  }

  // SONO : line arrays suspendus, subs au sol, retours de scène
  const spkTex = speakerTexture();
  const spkMat = [black, black, black, black, new THREE.MeshStandardMaterial({ map: spkTex, roughness: 0.8 }), black];
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.36, 0.62), spkMat);
      box.position.copy(L(TOWER_A - 0.4 - k * 0.03, s * 8.6, TOP - 0.7 - k * 0.37));
      box.rotation.x = k * 0.05;
      box.rotation.y = Math.PI;
      root.add(box);
    }
    for (let k = 0; k < 2; k++) {
      const sub = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 1.0), spkMat);
      sub.position.copy(L(2.2, s * 11.6, SY + 0.45 + k * 0.9));
      sub.rotation.y = Math.PI;
      sub.castShadow = true;
      root.add(sub);
    }
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, 0.5), spkMat);
    wedge.position.copy(L(2.0, s * 1.4, SY + 0.17));
    wedge.rotation.set(-0.5, Math.PI, 0);
    root.add(wedge);
  }
  // Nez de scène lumineux
  const lipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 1.6) });
  const lip = new THREE.Mesh(new THREE.BoxGeometry(2 * P.BW, 0.05, 0.05), lipMat);
  lip.position.copy(L(P.A_END + 0.02, 0, SY + 0.02));
  root.add(lip);

  // LYRES À FAISCEAUX sur la poutre : cônes additifs (aucune vraie lumière)
  const beamMat = new THREE.MeshBasicMaterial({
    map: beamTexture(), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const beamGeo = new THREE.CylinderGeometry(0.08, 1.7, 17, 18, 1, true);
  beamGeo.translate(0, -8.5, 0); // sommet à l'origine, le cône descend
  const heads = [];
  for (let k = 0; k < 8; k++) {
    const b = -8.4 + (k * 16.8) / 7;
    const pivot = new THREE.Group();
    pivot.position.copy(L(TOWER_A - 0.45, b, TOP - 0.45));
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.34), black);
    pivot.add(body);
    const mat = beamMat.clone();
    const beam = new THREE.Mesh(beamGeo, mat);
    beam.renderOrder = 5;
    beam.userData.noShadow = true;
    pivot.add(beam);
    root.add(pivot);
    heads.push({ pivot, mat, k });
  }
  // Rond de poursuite sur le plancher, sous la chanteuse
  const spotTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,250,235,0.9)');
    gr.addColorStop(0.7, 'rgba(255,250,235,0.35)');
    gr.addColorStop(1, 'rgba(255,250,235,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const floorSpot = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({
    map: spotTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  floorSpot.rotation.x = -Math.PI / 2;
  floorSpot.position.copy(L(4.2, 0, SY + 0.03));
  root.add(floorSpot);

  // LA CHANTEUSE, au centre de la scène, face aux gradins
  const singer = buildSinger();
  singer.group.position.copy(L(4.2, 0, SY));
  root.add(singer.group);
  // Calque réservé au gros plan de l'écran géant
  const CLOSE = 3;
  singer.group.traverse((o) => o.layers.enable(CLOSE));
  ctx.scene.traverse((o) => { if (o.isLight) o.layers.enable(CLOSE); });
  // Le VRAI modèle (public/models/chanteuse.glb, ~4 Mo) remplace la
  // version sculptée à l'approche du théâtre — pas au palier Bas (mémoire
  // des téléphones). En cas d'échec, la sculptée reste en scène.
  let rig = singer;
  let rigState = detail.level === 'bas' ? 'off' : 'idle';
  function loadRig() {
    rigState = 'loading';
    loadSingerModel('/models/chanteuse.glb').then((m) => {
      m.group.position.copy(singer.group.position);
      m.group.traverse((o) => o.layers.enable(CLOSE));
      root.add(m.group);
      singer.group.visible = false;
      rig = m;
      rigState = 'ok';
    }).catch((err) => {
      console.warn('🎤 Modèle de la chanteuse indisponible, version sculptée gardée :', err.message);
      rigState = 'off';
    });
  }

  // LE PUBLIC : une fosse de fans dans l'orchestre, face à la scène
  const fans = [];
  const rand = makeRand(2026);
  const shirts = [0xff4d6d, 0x2ec4b6, 0xffd166, 0x6a4c93, 0x1982c4, 0xf7f7f2, 0x111111, 0xff7a1a];
  for (let i = 0; i < 14; i++) {
    const a = -5.5 + rand() * 6, b = -7.5 + rand() * 15;
    const h = buildHuman({
      shirt: shirts[i % shirts.length],
      pants: [0x2b2f3a, 0x39404e, 0x50463c, 0x1c1c22][i % 4],
      skin: [0xe8c39e, 0x8d5a3b, 0xf0cfb0, 0xc68e63][(i * 7) % 4],
      hair: [0x3a2c1e, 0x111111, 0x8a5a2b, 0xd9c08a][(i * 3) % 4],
    });
    h.group.position.copy(L(a, b, 0));
    h.group.rotation.y = Math.PI + (rand() - 0.5) * 0.5; // regarde la scène
    root.add(h.group);
    fans.push({ h, phase: rand() * Math.PI * 2, wild: rand() });
  }

  // Gros plan : petite caméra qui filme la chanteuse (calque CLOSE seul)
  const closeCam = new THREE.PerspectiveCamera(26, 16 / 9, 0.05, 30);
  closeCam.layers.set(CLOSE);
  const closeBg = new THREE.Color(0x07070c);
  const headPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  // Point d'intérêt + borne d'info
  const [ix, iz] = P.world(-2, 0);
  ctx.pois?.push({ id: 'theatre', nom: 'Théâtre gallo-romain — concert', emoji: '🎤', x: P.cx, z: P.cz });
  ctx.interactables.push({
    x: ix, z: iz, r: 7,
    label: 'E — Programme du concert',
    action: () => {
      const st = concertState();
      ctx.notify?.(st.tomorrow === st.track
        ? `🎤 À Fourvière : « ${st.track.titre} » en boucle, tous les jours.`
        : `🎤 Ce soir à Fourvière : « ${st.track.titre} » en boucle. Demain : « ${st.tomorrow.titre} ».`);
    },
  });

  // --- Animation -------------------------------------------------------------
  const audio = createConcertAudio();
  ctx.concert = { audio, state: concertState, get video() { return video; }, levels: () => ({ ...lv, pulse, mouth, energy, beatCount }) };
  const lv = { bass: 0, voice: 0, all: 0 };
  let bassAvg = 0.3, voiceMax = 0.3, allMax = 0.3;
  let pulse = 0, beatCount = 0, lastBeat = 0, mouth = 0, energy = 0;
  let time = 0, frame = 0, greeted = false;
  let lastLyricKey = '';

  function drawLyrics(st) {
    const sec = st.playing ? sectionAt(st.track, st.t) : null;
    const lines = sec?.[2] ?? [];
    const idx = sec && lines.length ? Math.min(lines.length - 1, Math.floor(((st.t - sec[0]) / (sec[1] - sec[0])) * lines.length)) : -1;
    const left = st.playing ? '' : Math.ceil(st.track.duration + GAP - st.t);
    const key = `${st.track.id}|${idx}|${sec?.[0]}|${left}`;
    if (key === lastLyricKey) return;
    lastLyricKey = key;
    const g = lyricCanvas.getContext('2d');
    const W = lyricCanvas.width, H = lyricCanvas.height;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#120a1e');
    grad.addColorStop(1, '#05040a');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff7a1a';
    g.font = 'bold 22px "Courier New", monospace';
    g.textAlign = 'center';
    g.fillText('MORCEAU DU JOUR', W / 2, 40);
    g.fillStyle = '#ffffff';
    g.font = 'bold 34px sans-serif';
    wrap(g, st.track.titre.toUpperCase(), W / 2, 88, W - 30, 38);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(30, 150, W - 60, 2);
    if (!st.playing) {
      g.fillStyle = '#7ef0ff';
      g.font = 'bold 30px sans-serif';
      g.fillText('👏 MERCI LYON !', W / 2, 260);
      g.font = '24px sans-serif';
      g.fillStyle = '#ffffff';
      g.fillText(`On remet ça dans ${left} s`, W / 2, 310);
      lyricTex.needsUpdate = true;
      return;
    }
    let y = 200;
    g.font = '22px sans-serif';
    lines.forEach((line, i) => {
      g.fillStyle = i === idx ? '#ffe66d' : 'rgba(255,255,255,0.55)';
      g.font = i === idx ? 'bold 25px sans-serif' : '21px sans-serif';
      y = wrap(g, line, W / 2, y, W - 34, 30) + 12;
    });
    if (!lines.length) {
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.font = 'italic 24px sans-serif';
      g.fillText('♪ ♪ ♪', W / 2, 260);
    }
    lyricTex.needsUpdate = true;
  }

  ctx.updatables.push((dt) => {
    const p = ctx.playerPos?.();
    if (!p) return;
    const d = Math.hypot(p.x - P.cx, p.z - P.cz);
    const show = d < SHOW;
    root.visible = show;
    const st = concertState();
    // Son : plein volume dans la cavea, décroissance douce au-delà
    const k = Math.max(0, Math.min(1, 1 - (d - FULL) / (HEAR - FULL)));
    audio.update(st, 0.9 * k * k, performance.now(), d < 320);
    if (!show) return;
    time += dt;
    frame++;
    if (!greeted && d < 70) {
      greeted = true;
      ctx.notify?.(`🎤 Concert au théâtre de Fourvière ! Morceau du jour : « ${st.track.titre} »`);
    }

    // Niveaux : vrai son si on l'entend, sinon un tempo de secours (130 BPM)
    // pour que la scène vive aussi vue de loin
    const live = st.playing && audio.levels(lv);
    if (!live) {
      const beat = (st.t * 130) / 60;
      const f = beat - Math.floor(beat);
      const sec = st.playing ? sectionAt(st.track, st.t) : null;
      const singing = sec && sec[2].length ? 1 : 0;
      lv.bass = st.playing ? 0.35 + 0.5 * Math.exp(-f * 7) : 0;
      lv.voice = st.playing ? singing * (0.35 + 0.25 * Math.abs(Math.sin(st.t * 9.1) * Math.sin(st.t * 3.3))) : 0;
      lv.all = st.playing ? 0.45 : 0;
    }
    bassAvg += (lv.bass - bassAvg) * Math.min(1, dt * 2.5);
    voiceMax = Math.max(lv.voice, voiceMax - dt * 0.03);
    allMax = Math.max(lv.all, allMax - dt * 0.03);
    const nowMs = performance.now();
    if (lv.bass > bassAvg * 1.18 && lv.bass > 0.3 && nowMs - lastBeat > 280) {
      lastBeat = nowMs;
      pulse = 1;
      beatCount++;
    }
    pulse = Math.max(0, pulse - dt * 4.5);
    const vTarget = Math.max(0, Math.min(1, (lv.voice / Math.max(0.15, voiceMax) - 0.45) * 2.2));
    mouth += (vTarget - mouth) * Math.min(1, dt * 18);
    energy += (Math.min(1, lv.all / Math.max(0.2, allMax)) - energy) * Math.min(1, dt * 1.5);

    // LA CHANTEUSE
    const night = ctx.env?.night ?? 0;
    const sway = (beatCount % 2 ? 1 : -1) * (1 - pulse);
    if (rigState === 'idle' && d < 320) loadRig();
    const s = rig;
    s.group.position.y = SY + pulse * 0.02 * (st.playing ? 1 : 0);
    s.group.rotation.z = sway * 0.035;
    s.group.rotation.y = Math.sin(time * 0.23) * 0.38;
    s.head.rotation.x = -0.04 + pulse * 0.07;
    s.head.rotation.y = Math.sin(time * 0.61) * 0.18;
    s.mouth.scale.y = 0.25 + mouth * 1.3;
    const raise = st.playing ? Math.max(0, energy - 0.55) * 2.2 : 0.6 + 0.3 * Math.sin(time * 6); // bras levé au refrain / salut
    s.armL.rotation.x = -raise * 1.6 - pulse * 0.08;
    s.armL.rotation.z = -0.12 - raise * 0.5;
    s.armR.rotation.x = -0.04 * pulse;
    s.spot.value = 0.08 + 0.5 * night;
    s.apply?.(); // modèle à squelette : les os suivent ces réglages

    // FANS : sautillent sur les temps, bras en l'air au refrain
    // (épaule : rotation.x POSITIVE = bras vers l'avant puis en l'air ;
    // rotation.y = vers l'intérieur, ordre YXZ pour que les mains se
    // rejoignent devant la poitrine)
    for (const f of fans) {
      const L = f.h.armL.rotation, R = f.h.armR.rotation;
      L.order = R.order = 'YXZ';
      const hop = st.playing ? Math.max(0, Math.sin(time * 6.8 + f.phase)) * 0.06 * (0.4 + energy) : 0;
      f.h.group.position.y = hop;
      const tg = st.t - st.track.duration;
      const clapping = !st.playing || (f.wild > 0.55 && energy > 0.75 && Math.sin(time * 0.7 + f.phase) > 0.3);
      if (clapping) {
        // Applaudissements : avant-bras devant la poitrine, mains qui se
        // rejoignent ~4 fois par seconde (au début de la pause, plus vite)
        const rate = !st.playing && tg < 9 ? 26 : 16;
        const c = 0.5 + 0.5 * Math.sin(time * rate + f.phase);
        const raise = !st.playing && f.wild > 0.6 ? 2.2 : 1.25;
        L.set(raise, -(0.18 + 0.17 * c), 0);
        R.set(raise, 0.18 + 0.17 * c, 0);
      } else if (energy > 0.6 || f.wild > 0.7) {
        // Bras en l'air au refrain, qui ondulent sur le tempo
        L.set(2.7 + Math.sin(time * 3 + f.phase) * 0.25, -0.15, 0);
        R.set(f.wild > 0.4 ? 2.7 + Math.cos(time * 3 + f.phase) * 0.25 : 0.25 + pulse * 0.3, f.wild > 0.4 ? 0.15 : 0, 0);
      } else {
        // Au couplet : bras le long du corps qui marquent le temps
        L.set(0.15 + pulse * 0.35, 0, 0);
        R.set(0.15 + pulse * 0.35, 0, 0);
      }
    }

    // FAISCEAUX : balayages lents + couleur au fil des mesures, plus
    // visibles la nuit (le jour, à peine un voile)
    const hue = (Math.floor(beatCount / 8) * 0.13) % 1;
    for (const h of heads) {
      const ph = time * 0.7 + h.k * 0.8;
      h.pivot.rotation.x = 0.55 + Math.sin(ph) * 0.3; // vers le public
      h.pivot.rotation.z = Math.sin(ph * 0.6 + h.k) * 0.5;
      h.mat.color.setHSL((hue + (h.k % 2) * 0.5) % 1, 0.9, 0.55)
        .multiplyScalar((0.05 + 0.4 * night) * (st.playing ? 0.5 + pulse * 0.8 : 0.25));
    }
    floorSpot.material.opacity = 0.15 + 0.6 * night;
    lipMat.color.setRGB(0.2 + pulse, 0.9, 1.6);

    // ÉCRANS (pas à chaque image)
    if (frame % 6 === 1) drawLyrics(st);
    // Écran géant : le clip s'il existe ; sinon gros plans de la chanteuse
    // (2/3 du temps) et visuels géométriques, en alternance toutes les 8 s
    const hasClip = syncVideo(st, d < 320, nowMs);
    const mode = hasClip ? 'clip' : (!closeEvery || Math.floor(st.t / 8) % 3 === 2 ? 'geo' : 'close');
    const wanted = mode === 'clip' ? videoTex : mode === 'geo' ? geoTex : rt.texture;
    if (screenMat.map !== wanted) { screenMat.map = wanted; screenMat.needsUpdate = true; }
    if (mode === 'geo' && d < 180 && frame % 2 === 0) drawGeo(st, time, pulse, energy, lv.bass);
    if (mode === 'close' && ctx.renderer && d < 180 && frame % closeEvery === 0) {
      // Gros plan qui glisse doucement devant le visage
      s.head.getWorldPosition(headPos);
      headPos.y += 0.12;
      tmp.set(Math.sin(time * 0.17) * 0.6, 0.05, -1.7).applyQuaternion(s.group.getWorldQuaternion(new THREE.Quaternion()));
      closeCam.position.copy(headPos).add(tmp);
      closeCam.lookAt(headPos.x, headPos.y - 0.05, headPos.z);
      const r = ctx.renderer;
      // (brume gardée : à 1,7 m elle est nulle, et l'enlever changerait de
      // shader à chaque image)
      const prevBg = ctx.scene.background, prevAuto = r.shadowMap.autoUpdate;
      ctx.scene.background = closeBg;
      r.shadowMap.autoUpdate = false; // les ombres de l'image principale suffisent
      r.setRenderTarget(rt);
      r.render(ctx.scene, closeCam);
      r.setRenderTarget(null);
      r.shadowMap.autoUpdate = prevAuto;
      ctx.scene.background = prevBg;
    }
  });
}

// Texte centré sur plusieurs lignes ; renvoie le y suivant
function wrap(g, text, x, y, maxW, lh) {
  const words = String(text).split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y);
      line = w;
      y += lh;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
  return y + lh;
}
