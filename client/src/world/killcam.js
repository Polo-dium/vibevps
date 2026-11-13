import * as THREE from 'three';
import { state } from '../state.js';
import { buildHuman } from './human.js';
import { buildAvatar, avatarsEnabled, avatarFor } from './avatars.js';

// KILLCAM 🎥 — à ta mort dans l'arène, on te REJOUE la scène par-dessus
// l'épaule de celui qui t'a eu : les 2 dernières secondes avant le coup
// fatal, puis la 1re seconde d'après (3 s en tout, Espace ou un toucher
// pour passer).
//
// Rien n'est demandé au serveur : chaque client garde en mémoire les 7
// dernières secondes de ce qu'il a reçu (positions des autres, tirs) et de
// sa propre trajectoire. Le rejeu a toujours ≥ 2 s de retard sur le direct,
// donc la seconde « d'après » est déjà enregistrée quand on y arrive.
// Pendant le rejeu, on repose simplement les avatars aux positions d'alors
// (après remotes.update) et on déplace la caméra ; ton propre corps est un
// avatar fantôme qui s'écroule à l'instant du coup.

const BEFORE = 2, AFTER = 1, KEEP = 7;
const nowS = () => performance.now() / 1000;

export function createKillcam(ctx, { camera, remotes, controls, net, fx, getName }) {
  const tracks = new Map(); // id -> [{ t, x, y, z, ry }]
  const mine = [];
  const shots = [];
  let active = null;
  let lastSelf = 0;

  net.on('states', (msg) => {
    const t = nowS();
    for (const row of msg.s) {
      const [id, x, y, z, ry] = row;
      if (y < -30) continue; // bot mort « rangé » sous la carte : on garde sa dernière position
      let tr = tracks.get(id);
      if (!tr) tracks.set(id, tr = []);
      tr.push({ t, x, y, z, ry });
      while (tr.length > 2 && tr[0].t < t - KEEP) tr.shift();
    }
  });
  net.on('pleave', (msg) => tracks.delete(msg.id));
  net.on('shot', (msg) => {
    if (msg.melee || !Array.isArray(msg.a) || !Array.isArray(msg.b)) return;
    const t = nowS();
    shots.push({ t, a: msg.a, b: msg.b });
    while (shots.length && shots[0].t < t - KEEP) shots.shift();
  });

  function sample(tr, t, out) {
    if (!tr?.length) return null;
    let i = tr.length - 1;
    while (i > 0 && tr[i].t > t) i--;
    const a = tr[i], b = tr[Math.min(tr.length - 1, i + 1)];
    const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
    let dry = b.ry - a.ry;
    while (dry > Math.PI) dry -= Math.PI * 2;
    while (dry < -Math.PI) dry += Math.PI * 2;
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.ry = a.ry + dry * k;
    return out;
  }

  // Ton corps, vu de l'extérieur : le même personnage que les autres voient
  // (avatar chargé en fond ; sculpté en attendant, ou au palier Bas)
  let ghost = null;
  if (avatarsEnabled()) {
    setTimeout(() => buildAvatar(avatarFor(getName?.() ?? '')).then((av) => {
      if (active) return; // pas d'échange en plein rejeu
      if (ghost) ctx.scene.remove(ghost.group);
      av.group.visible = false;
      av.group.traverse((o) => { o.frustumCulled = false; });
      ctx.scene.add(av.group);
      ghost = av;
    }).catch(() => {}), 4000);
  }
  function ensureGhost() {
    if (ghost) return ghost;
    ghost = buildHuman({ shirt: 0xe8e2d0, pants: 0x39404e, fem: false, veste: false, jupe: false, barbe: false });
    ghost.group.visible = false;
    ghost.group.traverse((o) => { o.frustumCulled = false; });
    ctx.scene.add(ghost.group);
    return ghost;
  }

  const overlay = document.createElement('div');
  overlay.id = 'killcam';
  overlay.className = 'hidden';
  overlay.innerHTML = '<div class="kc-bar"></div><div class="kc-label"><b>KILLCAM</b><span id="kc-name"></span><i id="kc-skip"></i></div><div class="kc-bar"></div>';
  document.body.appendChild(overlay);

  const hidden = [];
  const _k = {}, _m = {}, _s = {};
  const _look = new THREE.Vector3();

  function start(killerId, killerName, onDone) {
    const tr = tracks.get(killerId);
    if (active || !tr?.length || mine.length < 2) return false;
    const t0 = nowS();
    active = { t0, killerId, onDone, lastSim: t0 - BEFORE, wasOverlay: state.overlayOpen };
    state.overlayOpen = true; // gèle déplacements et tir pendant le rejeu
    state.killcam = true;
    ensureGhost().group.visible = true;
    hidden.length = 0;
    for (const c of camera.children) if (c.visible) { hidden.push(c); c.visible = false; }
    overlay.querySelector('#kc-name').textContent = killerName ?? '';
    overlay.querySelector('#kc-skip').textContent = 'ontouchstart' in window ? 'toucher pour passer' : 'Espace pour passer';
    overlay.classList.remove('hidden');
    return true;
  }

  function stop() {
    if (!active) return;
    const { onDone, wasOverlay } = active;
    if (active.rag) { ghost.ragdollStop?.(); ghost.group.rotation.set(0, 0, 0); }
    active = null;
    state.overlayOpen = wasOverlay;
    state.killcam = false;
    if (ghost) { ghost.group.visible = false; ghost.group.rotation.x = 0; }
    for (const c of hidden) c.visible = true;
    hidden.length = 0;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    overlay.classList.add('hidden');
    onDone?.();
  }
  window.addEventListener('keydown', (e) => { if (active && e.code === 'Space' && nowS() - active.t0 > 0.4) stop(); });
  overlay.addEventListener('touchstart', (e) => { e.preventDefault(); if (active && nowS() - active.t0 > 0.4) stop(); }, { passive: false });

  // À appeler à chaque image, APRÈS controls.update et remotes.update
  function update() {
    const t = nowS();
    if (!active) {
      // enregistrement de ma propre trajectoire (30 fois/s)
      if (t - lastSelf > 0.033) {
        lastSelf = t;
        const p = controls.position;
        mine.push({ t, x: p.x, y: p.y, z: p.z, ry: controls.yaw });
        while (mine.length > 2 && mine[0].t < t - KEEP) mine.shift();
      }
      return;
    }
    let tau = t - active.t0;
    if (globalThis.__kcHold != null) tau = Math.min(tau, globalThis.__kcHold); // (débogage : arrêt sur image)
    if (tau >= BEFORE + AFTER) { stop(); return; }
    const sim = active.t0 - BEFORE + tau;

    // Tout le monde reprend sa place d'alors
    for (const [id, tr] of tracks) {
      const g = remotes.getGroup(id);
      if (!g || !sample(tr, sim, _s)) continue;
      g.position.set(_s.x, _s.y, _s.z);
      g.rotation.y = _s.ry;
    }
    // Moi : le fantôme marche jusqu'au coup fatal, puis s'écroule
    sample(mine, Math.min(sim, active.t0), _m);
    const gh = ghost.group;
    // Coup fatal : RAGDOLL (comme les autres combattants), poussé dans le
    // sens du tir ; à défaut d'avatar, l'ancienne bascule en arrière.
    if (sim >= active.t0 && !active.rag && !active.ragTried) {
      active.ragTried = true;
      gh.position.set(_m.x, _m.y, _m.z);
      gh.rotation.set(0, _m.ry, 0);
      let dx = Math.sin(_m.ry), dz = Math.cos(_m.ry);
      if (sample(tracks.get(active.killerId), sim, _k)) { dx = _m.x - _k.x; dz = _m.z - _k.z; }
      const l = Math.hypot(dx, dz) || 1;
      active.rag = Boolean(ghost.ragdollStart?.(dx / l, dz / l));
      active.ragT = sim;
    }
    if (active.rag) {
      ghost.ragdollStep(Math.max(0, Math.min(0.25, sim - active.ragT)), _m.y);
      active.ragT = sim;
    } else {
      gh.position.set(_m.x, _m.y, _m.z);
      gh.rotation.y = _m.ry;
    }
    const fall = active.rag ? 0 : Math.max(0, Math.min(1, (sim - active.t0) / 0.45));
    if (!active.rag) gh.rotation.x = -fall * fall * 1.45;
    gh.rotation.order = 'YXZ';
    // vitesse d'alors (pour marcher ou courir comme à ce moment-là)
    const v = Math.hypot(_m.x - (active.px ?? _m.x), _m.z - (active.pz ?? _m.z)) / Math.max(0.001, sim - active.lastSim);
    active.px = _m.x; active.pz = _m.z;
    active.v = (active.v ?? 0) * 0.8 + Math.min(v, 12) * 0.2;
    gh.userData.baseY = _m.y;
    gh.position.y += fall * 0.12;
    if (!active.rag) { try { ghost.animate(sim * 9, fall > 0 ? 0 : active.v * 2.6); } catch { /* avatar sans animation */ } }

    // Caméra par-dessus l'épaule du tireur, braquée sur moi
    if (sample(tracks.get(active.killerId), sim, _k)) {
      let dx = _m.x - _k.x, dz = _m.z - _k.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) { dx = -Math.sin(_k.ry); dz = -Math.cos(_k.ry); } else { dx /= d; dz /= d; }
      const back = Math.min(2.1, 0.9 + d * 0.3);
      camera.position.set(_k.x - dx * back - dz * 0.55, _k.y + 1.85, _k.z - dz * back + dx * 0.55);
      camera.rotation.order = 'YXZ';
      camera.lookAt(_look.set(_m.x, _m.y + 1.0, _m.z));
      // tir de loin : on resserre le cadre pour que la victime reste lisible
      const zoom = Math.max(1, Math.min(3, d / 18));
      if (Math.abs(camera.zoom - zoom) > 0.01) { camera.zoom = zoom; camera.updateProjectionMatrix(); }
    }
    // Les tirs d'alors repassent au bon moment
    for (const s of shots) {
      if (s.t > active.lastSim && s.t <= sim) {
        fx.spawnTracer(s.a, s.b, false);
        fx.spawnImpact(s.b);
      }
    }
    active.lastSim = sim;
  }

  return { start, stop, update, get active() { return Boolean(active); }, get ghost() { return ghost; } };
}
