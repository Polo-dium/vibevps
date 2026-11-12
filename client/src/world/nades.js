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
  function boom(p) {
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
