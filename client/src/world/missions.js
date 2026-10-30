import * as THREE from 'three';
import { state, apiFetch } from '../state.js';
import { buildHuman } from './human.js';

// MISSIONS DES PNJ : un PNJ (patron du bouchon, guide de Fourvière,
// Guignol…) confie une petite course. Le serveur (Claude) choisit UN lieu
// réel parmi ceux qu'on lui envoie et invente l'objet à rapporter. Côté
// client : balise lumineuse sur le lieu (+ carte), objet ramassé en passant
// à moins de 9 m, puis retour au PNJ (balise sur lui) → XP versée par le
// serveur (il vérifie le PNJ et le délai). Une mission à la fois.
//
// Les PNJ « causeurs » de plein air (guide, Guignol, conducteur de la
// ficelle, supporter de l'OL) sont posés ici, à côté de leur lieu.

const LS_KEY = 'lyon_mission';
const PICK_R = 9;
const HAND_R = 6;

// Lieux qu'on ne peut pas proposer (en l'air, hors carte, trop vagues)
const SKIP = /^(aeroport|grand-prix-ciel|avion-rc|arcade)/;

export function createMissions(ctx, { ui, audio, onXp }) {
  let cur = null; // { mission, stage: 'go'|'back', npcPos: {x,z} }
  try { cur = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { /* vierge */ }
  const save = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cur)); } catch { /* plein */ }
  };
  // Dernière position du joueur HORS des poches (bouchon, traboules) : c'est
  // là qu'on attend le retour pour les PNJ d'intérieur.
  let lastOut = null;
  const npcPos = new Map();

  // --- Balise : colonne de lumière additive + emoji flottant ---------------
  const beacon = new THREE.Group();
  const beamTex = (() => {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.9, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({
      map: beamTex, color: 0xffd34d, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    })
  );
  beam.position.y = 30;
  beacon.add(beam);
  const icon = makeLabelSprite('🎁', 2.2);
  icon.position.y = 4;
  beacon.add(icon);
  beacon.traverse((o) => { o.userData.noShadow = true; o.frustumCulled = false; });
  beacon.visible = false;
  ctx.scene.add(beacon);

  const mark = { x: 0, z: 0, emoji: '🎁', label: '', color: '#ffd34d', hidden: true };
  ctx.mapMarks ??= [];
  ctx.mapMarks.push(mark);

  const poiOf = (id) => (ctx.pois ?? []).find((p) => p.id === id);
  function target() {
    if (!cur) return null;
    if (cur.stage === 'go') {
      const p = poiOf(cur.mission.placeId);
      return p ? { x: p.x, z: p.z } : null;
    }
    return cur.npcPos ?? npcPos.get(cur.mission.npc) ?? null;
  }

  function refresh() {
    const t = target();
    if (!cur || !t) {
      beacon.visible = false;
      mark.hidden = true;
      ctx.setMissionQuest?.(null);
      return;
    }
    const m = cur.mission;
    const back = cur.stage === 'back';
    beacon.visible = true;
    beacon.position.set(t.x, Math.max(0, ctx.terrainHeight?.(t.x, t.z) ?? 0), t.z);
    beam.material.color.setHex(back ? 0x5dffb0 : 0xffd34d);
    setLabel(icon, back ? '💬' : m.emoji);
    Object.assign(mark, {
      x: t.x, z: t.z, hidden: false, emoji: back ? '💬' : m.emoji,
      label: back ? m.npcNom : m.placeNom, color: back ? '#5dffb0' : '#ffd34d',
    });
    ctx.setMissionQuest?.({
      icon: '📜', title: `Mission de ${m.npcNom ?? 'un gone'}`,
      items: [
        { label: `Trouver ${m.objet} (${m.placeNom})`, done: back },
        { label: `Le rapporter à ${m.npcNom}`, done: false },
      ],
      hint: back ? `Retourne voir ${m.npcNom} (balise verte)` : `Suis la balise dorée jusqu'à ${m.placeNom}`,
    });
  }

  function start(mission, pos) {
    cur = { mission, stage: 'go', npcPos: pos ?? npcPos.get(mission.npc) ?? null };
    save();
    refresh();
    audio?.reward?.();
  }

  function drop() {
    cur = null;
    save();
    refresh();
  }

  // Lieux proposés au serveur : POI réels, ni trop près ni à l'autre bout
  function places() {
    const p = lastOut ?? ctx.playerPos?.() ?? { x: 0, z: 0 };
    const seen = new Set();
    const all = [];
    for (const poi of ctx.pois ?? []) {
      if (!poi.nom || SKIP.test(poi.id) || seen.has(poi.nom)) continue;
      seen.add(poi.nom);
      all.push({ id: poi.id, nom: poi.nom, d: Math.hypot(poi.x - p.x, poi.z - p.z) });
    }
    let pool = all.filter((o) => o.d > 70 && o.d < 900);
    if (pool.length < 4) pool = all.filter((o) => o.d > 30);
    for (let i = pool.length - 1; i > 0; i--) { // mélange (pas du décor : Math.random ok)
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 10).map(({ id, nom }) => ({ id, nom }));
  }

  // Demande d'une mission (bouton 📜 du panneau de dialogue)
  async function ask(npc) {
    const out = await apiFetch('/npc/quest', { method: 'POST', body: JSON.stringify({ npc, places: places() }) });
    if (!poiOf(out.placeId)) throw new Error('Ce lieu n’existe pas dans ta ville…');
    if (!cur || cur.mission.npc !== npc || cur.mission.placeId !== out.placeId) start(out, npcPos.get(npc) ?? lastOut);
    return out;
  }

  // Remise au PNJ : renvoie la promesse du serveur ou null si rien à rendre
  function handIn(npc) {
    if (!cur || cur.stage !== 'back' || cur.mission.npc !== npc) return null;
    return apiFetch('/npc/quest/done', { method: 'POST', body: JSON.stringify({ npc }) }).then((res) => {
      drop();
      if (res.xp != null) onXp?.(res.xp);
      ui.spawnConfetti?.(40);
      ui.toast(`📜 Mission accomplie : ${res.emoji ?? ''} ${res.objet} → +${res.xpGain} XP`);
      audio?.reward?.();
      return res;
    }, (err) => {
      if (/Aucune mission/.test(err.message)) drop();
      throw err;
    });
  }

  // Le serveur a pu redémarrer (mission perdue) : on se recale au chargement
  if (cur && state.auth) {
    apiFetch('/npc/quest').then((r) => {
      if (!r.mission || r.mission.npc !== cur?.mission.npc) drop();
    }).catch(() => {});
  }

  // --- Boucle : ramassage, position des PNJ, balise qui respire -------------
  let tm = 0;
  ctx.updatables.push((dt) => {
    const p = ctx.playerPos?.();
    if (!p) return;
    if (!ctx.inPocket?.(p.x, p.z)) lastOut = { x: p.x, z: p.z };
    if (!cur) return;
    tm += dt;
    icon.position.y = 4 + Math.sin(tm * 2.2) * 0.35;
    beam.material.opacity = 0.42 + Math.sin(tm * 3) * 0.12;
    if (cur.stage === 'go') {
      const t = target();
      if (t && Math.hypot(t.x - p.x, t.z - p.z) < PICK_R) {
        cur.stage = 'back';
        save();
        refresh();
        ui.spawnConfetti?.(18);
        ui.toast(`${cur.mission.emoji} Tu as trouvé ${cur.mission.objet} ! Rapporte-le à ${cur.mission.npcNom}.`);
        audio?.reward?.();
      }
    }
  });

  // Un PNJ qui parle note sa place (balise du retour) ; les PNJ d'intérieur
  // prennent la dernière position du joueur dehors (la porte).
  function noteNpc(id, pos) {
    if (!pos && npcPos.has(id)) return; // place exacte déjà connue
    const at = pos ?? lastOut;
    if (at) npcPos.set(id, { x: at.x, z: at.z });
  }

  refresh();
  const api = { ask, handIn, noteNpc, current: () => cur, drop, refresh };
  ctx.missions = api;
  return api;
}

// --- PNJ causeurs de plein air ---------------------------------------------
const TALKERS = [
  {
    id: 'guide', poi: 'basilique', title: 'Lucie, guide de Fourvière', emoji: '🧭', short: 'Lucie',
    look: { shirt: 0x2f7d5b, pants: 0x3b3f4a, skin: 0xf0cfb0, hair: 0x8a5a2b, style: 'long', fem: true, veste: 0x2a3a2e, jupe: true, barbe: false },
    greet: 'Bonjour ! Bienvenue sur la colline qui prie. Une question sur Lyon ?',
    lines: ['La basilique, on l’appelle l’éléphant renversé : regardez ses quatre tours !',
      'Lugdunum, capitale des Gaules, c’était ici même, il y a deux mille ans.',
      'Le 8 décembre, toute la ville pose des lumignons aux fenêtres. Magique !'],
  },
  {
    id: 'guignol', poi: 'guignol', title: 'Guignol', emoji: '🎭', short: 'Guignol',
    look: { shirt: 0x7a3b22, pants: 0x2b2b30, skin: 0xf0cfb0, hair: 0x111111, style: 'court', fem: false, veste: 0x7a3b22, jupe: false, barbe: false },
    greet: 'Salut les gones ! Ah c’est toi ? T’as pas vu Gnafron ? Il me doit un pot !',
    lines: ['Gnafron ? Encore au bouchon, à coup sûr !',
      'Le gendarme me cherche, fais comme si t’avais rien vu, gone.',
      'Un pot de Beaujolais, une quenelle, et le monde va mieux !'],
  },
  {
    id: 'conducteur', poi: 'ficelle', title: 'Marcel, conducteur de la ficelle', emoji: '🚡', short: 'Marcel',
    look: { shirt: 0xe8e3d8, pants: 0x1f2f55, skin: 0xe8c39e, hair: 0x6b6b6b, style: 'casquette', fem: false, veste: 0x1f2f55, jupe: false, barbe: true },
    greet: 'Bonjour ! La ficelle part toutes les deux minutes, montez donc.',
    lines: ['Trente ans que je monte et descends cette colline, je connais chaque caillou.',
      'Les deux cabines se croisent pile au milieu, c’est le contrepoids.',
      'Ça monte sec, Fourvière ! Heureusement que la ficelle est là.'],
  },
  {
    id: 'supporter', poi: 'roi', title: 'Kévin, supporter de l’OL', emoji: '⚽', short: 'Kévin',
    look: { shirt: 0xf2f2f2, pants: 0x1d3c8f, skin: 0xc68e63, hair: 0x111111, style: 'casquette', fem: false, veste: false, jupe: false, barbe: false },
    greet: 'Wesh gone ! Allez l’OL ! Tu viens au match ce soir ?',
    lines: ['Allez l’OL, allez allez l’OL !', 'Les Verts ? Connais pas. À Lyon on est rouge et bleu.',
      'Le Groupama Stadium, quand ça chante, ça fait trembler Décines !'],
  },
];

// Posés à la PREMIÈRE frame : certains lieux (castelet, ficelle…) sont
// déclarés après la construction de la ville.
export function createTalkers(ctx) {
  const placed = [];
  let ready = false;
  const blocked = (x, z) => {
    if (ctx.waterMask?.isWater(x, z) || ctx.theatre?.covers?.(x, z)) return true;
    for (const b of ctx.colliders.nearby?.(x, z, 1) ?? []) {
      if (x > b.minX - 0.8 && x < b.maxX + 0.8 && z > b.minZ - 0.8 && z < b.maxZ + 0.8 && b.maxY - b.minY > 0.6) return true;
    }
    return false;
  };
  function place() {
    for (const T of TALKERS) {
      const poi = (ctx.pois ?? []).find((p) => p.id === T.poi);
      if (!poi) continue;
      // Une place libre près du lieu : spirale déterministe (pas de hasard)
      let spot = null;
      for (let r = 4; r <= 22 && !spot; r += 2) {
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2 + r * 0.37;
          const x = poi.x + Math.cos(a) * r, z = poi.z + Math.sin(a) * r;
          if (!blocked(x, z) && !blocked(x + 0.6, z) && !blocked(x, z + 0.6)) { spot = { x, z }; break; }
        }
      }
      if (!spot) continue;
      const h = buildHuman(T.look);
      const y = Math.max(0, ctx.terrainHeight?.(spot.x, spot.z) ?? 0);
      h.group.position.set(spot.x, y, spot.z);
      h.group.userData.baseY = y;
      h.group.rotation.y = Math.atan2(-(poi.x - spot.x), -(poi.z - spot.z)) + Math.PI; // dos au lieu, face aux passants
      h.animate(0, 0);
      ctx.scene.add(h.group);
      // Bulle au-dessus de la tête : 💬, ou 🎁/❗ quand une mission l'attend
      const bubble = makeLabelSprite('💬', 0.9);
      bubble.position.set(0, 2.45, 0);
      bubble.visible = false;
      h.group.add(bubble);
      const pick = () => T.lines[Math.floor(Date.now() / 45000) % T.lines.length];
      ctx.interactables.push({
        x: spot.x, z: spot.z, r: 3.2, label: `E — Causer avec ${T.short}`,
        action: () => {
          ctx.missions?.noteNpc(T.id, spot);
          if (ctx.talkTo?.(T.id, { title: T.title, emoji: T.emoji, greet: T.greet, fallback: pick })) return;
          ctx.notify?.(`${T.emoji} ${T.short} : « ${pick()} »`);
        },
      });
      placed.push({ T, h, spot, bubble, yaw0: h.group.rotation.y, yaw: h.group.rotation.y, phase: Math.random() * 6, icon: '💬' });
    }
  }

  ctx.updatables.push((dt) => {
    if (!ready) { ready = true; place(); }
    const p = ctx.playerPos?.();
    if (!p) return;
    const m = ctx.missions?.current();
    for (const n of placed) {
      const dx = p.x - n.spot.x, dz = p.z - n.spot.z, d = Math.hypot(dx, dz);
      n.bubble.visible = d < 28;
      if (d > 40) continue;
      // se tourne vers le joueur quand il approche, revient à sa pose sinon
      const want = d < 9 ? Math.atan2(-dx, -dz) : n.yaw0;
      let diff = ((want - n.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      n.yaw += diff * Math.min(1, dt * 4);
      n.h.group.rotation.y = n.yaw;
      // respiration / petit geste (Guignol gesticule)
      n.phase += dt;
      const g = n.T.id === 'guignol' ? 0.5 : 0.08;
      n.h.armR.rotation.x = -Math.max(0, Math.sin(n.phase * 1.7)) * g;
      n.h.armL.rotation.x = -Math.max(0, Math.sin(n.phase * 1.3 + 1)) * g * 0.6;
      const icon = m && m.mission.npc === n.T.id ? (m.stage === 'back' ? '❗' : '⏳') : '💬';
      if (icon !== n.icon) { n.icon = icon; setLabel(n.bubble, icon); }
      if (m?.stage === 'back' && m.mission.npc === n.T.id && !m.npcPos) {
        m.npcPos = { x: n.spot.x, z: n.spot.z };
        ctx.missions.refresh();
      }
    }
  });
  return placed;
}

// --- Sprites texte (emoji / bulles) ----------------------------------------
function makeLabelSprite(text, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(size, size, 1);
  s.userData.canvas = c;
  setLabel(s, text);
  return s;
}

function setLabel(sprite, text) {
  const c = sprite.userData.canvas;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.font = '46px system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 36);
  sprite.material.map.needsUpdate = true;
}
