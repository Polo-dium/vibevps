import * as THREE from 'three';
import { state } from '../state.js';
import { ARENA, arenaBoxes } from '../../../shared/arena-layout.js';
import { NADE, stepNade } from '../../../shared/arena-nade.js';

// GRENADES ET FUMIGÈNES DE L'ARÈNE — côté client. Le serveur décide de tout
// (dotation, explosion, dégâts) ; ici on lance (`throwNade`), on fait voler
// le projectile avec la MÊME physique que lui (shared/arena-nade.js) et on
// montre le résultat : explosion, nuage de fumée, impacts de la frappe de
// quenelles (série de 5 éliminations).
const OX = ARENA.OFFSET;

export function createNades(ctx, { net, camera, controls, fx, audio, ui }) {
  const boxes = arenaBoxes();
  const flying = new Map(); // id → { mesh, n, until }
  const clouds = [];        // { group, born }
  const strikes = [];       // { ring, at, p }
  const inv = { f: 0, s: 0, armor: 0 };

  const geo = new THREE.SphereGeometry(0.075, 10, 8);
  const mats = {
    f: new THREE.MeshLambertMaterial({ color: 0x3f4a2c }),
    s: new THREE.MeshLambertMaterial({ color: 0xb9bdc2 }),
  };
  const puffTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const ringGeo = new THREE.RingGeometry(1.6, 2.1, 28);
  ringGeo.rotateX(-Math.PI / 2);

  // --- HUD : dotation et armure (au-dessus des munitions) ---------------------
  const hud = document.createElement('div');
  hud.id = 'hud-nades';
  hud.className = 'hidden';
  document.body.appendChild(hud);
  function renderHud() {
    hud.classList.toggle('hidden', !ctx.inHiFi);
    hud.innerHTML =
      (inv.armor > 0 ? `<span class="armor">🛡 ${inv.armor}</span>` : '') +
      `<span class="${inv.f ? '' : 'empty'}">💣 ${inv.f}</span><span class="${inv.s ? '' : 'empty'}">💨 ${inv.s}</span>`;
    for (const [id, n] of [['tb-nade', inv.f], ['tb-smoke', inv.s]]) {
      const b = document.getElementById(id);
      if (b) { b.dataset.n = n; b.classList.toggle('empty', !n); }
    }
  }
  net.on('nadeInv', (msg) => { inv.f = msg.f; inv.s = msg.s; inv.armor = msg.armor ?? 0; renderHud(); });

  // --- Lancer -------------------------------------------------------------------
  const _d = new THREE.Vector3();
  function throwNade(k) {
    if (!ctx.inHiFi || state.overlayOpen || state.killcam) return;
    if (!(k === 's' ? inv.s : inv.f)) { ui.toast(k === 's' ? '💨 Plus de fumigène (un par vie).' : '💣 Plus de grenade (deux par vie).'); return; }
    camera.getWorldDirection(_d);
    net.send({ t: 'nade', k, d: [_d.x, _d.y, _d.z].map((v) => Math.round(v * 1000) / 1000) });
  }

  // --- Réseau -------------------------------------------------------------------
  net.on('nade', (msg) => {
    if (!ctx.inHiFi) return;
    const mesh = new THREE.Mesh(geo, mats[msg.k] ?? mats.f);
    mesh.userData.noShadow = true;
    ctx.scene.add(mesh);
    flying.set(msg.id, {
      mesh,
      n: { x: msg.p[0] - OX, y: msg.p[1], z: msg.p[2], vx: msg.v[0], vy: msg.v[1], vz: msg.v[2] },
      until: performance.now() + ((NADE.fuse[msg.k] ?? 2.3) + 1.2) * 1000,
    });
  });
  // --- EXPLOSION : éclair, boule de feu, onde de choc au sol, panache de
  // fumée qui monte, trace de brûlé. Sprites et anneaux additifs (aucune
  // vraie lumière), une vingtaine d'objets par explosion, tous retirés à la fin.
  const fxParts = []; // { o, born, dur, kind, vx, vy, vz, s0, s1, op }
  const scorches = [];
  const waveGeo = new THREE.RingGeometry(0.82, 1, 40);
  waveGeo.rotateX(-Math.PI / 2);
  const scorchGeo = new THREE.CircleGeometry(1, 20);
  scorchGeo.rotateX(-Math.PI / 2);
  function sprite(color, additive) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: puffTex, color, transparent: true, opacity: 0, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    sp.userData.noShadow = true;
    return sp;
  }
  function addPart(o, x, y, z, dur, kind, extra = {}) {
    o.position.set(x, y, z);
    ctx.scene.add(o);
    fxParts.push({ o, born: performance.now(), dur, kind, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, op: 1, ...extra });
  }
  function blast(p) {
    const [x, y, z] = p;
    const gy = Math.max(0.3, y);
    addPart(sprite(0xfff1c4, true), x, gy + 0.6, z, 0.22, 'flash', { s0: 3, s1: 15, op: 1 });
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.3;
      addPart(sprite(i % 2 ? 0xff7a1c : 0xffb347, true), x + Math.cos(a) * r, gy + 0.5 + Math.random() * 0.9, z + Math.sin(a) * r,
        0.5 + Math.random() * 0.25, 'fire', { s0: 1.6, s1: 5.2 + Math.random() * 1.8, op: 0.95, vy: 2.2 + Math.random() * 1.6, vx: Math.cos(a) * 1.4, vz: Math.sin(a) * 1.4 });
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Math.random(), r = 0.4 + Math.random() * 1.6;
      addPart(sprite(i % 3 ? 0x3a3a3c : 0x5a5855, false), x + Math.cos(a) * r, gy + 0.7 + Math.random() * 1.2, z + Math.sin(a) * r,
        1.9 + Math.random() * 0.9, 'smoke', { s0: 2.2, s1: 7 + Math.random() * 2.5, op: 0.7, vy: 1.5 + Math.random() * 1.1, vx: Math.cos(a) * 0.9, vz: Math.sin(a) * 0.9 });
    }
    const wave = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    wave.userData.noShadow = true;
    addPart(wave, x, 0.14, z, 0.45, 'wave', { s0: 0.6, s1: 8.5, op: 0.8 });
    // trace de brûlé (8 au plus, la plus ancienne s'efface)
    const scorch = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({
      map: puffTex, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    scorch.userData.noShadow = true;
    scorch.scale.setScalar(2.6 + Math.random() * 0.8);
    scorch.position.set(x, 0.08, z);
    ctx.scene.add(scorch);
    scorches.push({ o: scorch, born: performance.now() });
    if (scorches.length > 8) { const old = scorches.shift(); ctx.scene.remove(old.o); old.o.material.dispose(); }
  }
  function updateFx(now, dt) {
    for (let i = fxParts.length - 1; i >= 0; i--) {
      const f = fxParts[i];
      const t = (now - f.born) / (f.dur * 1000);
      if (t >= 1) { ctx.scene.remove(f.o); f.o.material.dispose(); fxParts.splice(i, 1); continue; }
      const e = 1 - (1 - t) * (1 - t); // part vite, finit doucement
      const s = f.s0 + (f.s1 - f.s0) * e;
      if (f.kind === 'wave') f.o.scale.set(s, 1, s); else f.o.scale.set(s, s, 1);
      f.o.position.x += f.vx * dt; f.o.position.y += f.vy * dt; f.o.position.z += f.vz * dt;
      f.o.material.opacity = f.op * (f.kind === 'smoke' ? Math.min(1, t * 6) * (1 - t) : 1 - t * t);
    }
    for (let i = scorches.length - 1; i >= 0; i--) {
      const age = (now - scorches[i].born) / 1000;
      if (age > 40) { ctx.scene.remove(scorches[i].o); scorches[i].o.material.dispose(); scorches.splice(i, 1); } else if (age > 30) scorches[i].o.material.opacity = 0.6 * (1 - (age - 30) / 10);
    }
  }
  function boom(p) {
    blast(p);
    fx.spawnExplosion(p);
    const d = camera.position.distanceTo(new THREE.Vector3(...p));
    if (d < 70) audio.explosion();
    // souffle : la visée tressaute si c'est tombé près
    if (d < 14) controls.kick((Math.random() - 0.3) * 0.05 * (1 - d / 14), (Math.random() - 0.5) * 0.05 * (1 - d / 14));
  }
  net.on('boom', (msg) => {
    const fl = flying.get(msg.id);
    if (fl) { ctx.scene.remove(fl.mesh); flying.delete(msg.id); }
    if (!ctx.inHiFi) return;
    if (msg.k === 's') {
      // Fumigène : une dizaine de bouffées qui gonflent puis se dissipent
      const group = new THREE.Group();
      for (let i = 0; i < 10; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: puffTex, color: 0xa4abb2, transparent: true, opacity: 0, depthWrite: false,
        }));
        const a = (i / 10) * Math.PI * 2, r = i < 3 ? 0 : 2.2 + (i % 3) * 0.9;
        sp.position.set(Math.cos(a) * r, 1.4 + (i % 4) * 0.75, Math.sin(a) * r);
        sp.userData.s = 5.5 + (i % 3) * 1.6;
        sp.userData.noShadow = true;
        group.add(sp);
      }
      group.position.set(msg.p[0], msg.p[1], msg.p[2]);
      ctx.scene.add(group);
      clouds.push({ group, born: performance.now() });
    } else if (msg.k === 'q') {
      // Frappe de quenelles : cercle rouge au sol, puis ça tombe
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xff4a3d, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
      }));
      ring.position.set(msg.p[0], 0.12, msg.p[2]);
      ring.userData.noShadow = true;
      ctx.scene.add(ring);
      strikes.push({ ring, at: performance.now() + (msg.in ?? 900), p: msg.p });
    } else {
      boom(msg.p);
    }
  });

  // --- Boucle ---------------------------------------------------------------------
  let wasIn = false;
  ctx.updatables.push((dt) => {
    const now = performance.now();
    updateFx(now, dt);
    if (Boolean(ctx.inHiFi) !== wasIn) { wasIn = Boolean(ctx.inHiFi); renderHud(); }
    for (const [id, fl] of flying) {
      stepNade(fl.n, dt, boxes);
      fl.mesh.position.set(fl.n.x + OX, fl.n.y, fl.n.z);
      if (now > fl.until) { ctx.scene.remove(fl.mesh); flying.delete(id); }
    }
    for (let i = clouds.length - 1; i >= 0; i--) {
      const c = clouds[i];
      const t = (now - c.born) / 1000;
      if (t > NADE.smokeDur) { ctx.scene.remove(c.group); clouds.splice(i, 1); continue; }
      const grow = Math.min(1, t / 1.2);
      const fade = Math.min(1, (NADE.smokeDur - t) / 2.5);
      for (const sp of c.group.children) {
        const s = sp.userData.s * (0.25 + 0.75 * grow) * (1 + t * 0.012);
        sp.scale.set(s, s, 1);
        sp.material.opacity = 0.9 * grow * fade;
      }
    }
    for (let i = strikes.length - 1; i >= 0; i--) {
      const s = strikes[i];
      const left = (s.at - now) / 1000;
      s.ring.scale.setScalar(Math.max(0.3, left)); // le cercle se resserre
      if (left <= 0) {
        ctx.scene.remove(s.ring);
        strikes.splice(i, 1);
        if (ctx.inHiFi) boom([s.p[0], 0.4, s.p[2]]);
      }
    }
  });

  return { throwNade, get inv() { return inv; } };
}
