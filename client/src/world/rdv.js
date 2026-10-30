import * as THREE from 'three';

// RENDEZ-VOUS : un joueur touche la carte (M) → balise 📍 chez tout le monde
// pendant 90 s (colonne de lumière à sa couleur + repère sur la carte). Le
// serveur ne fait que relayer (message WS optionnel `rdv`, limité à 1 / 8 s).
const TTL = 90_000;
const MAX = 6;

export function createRdv(ctx, { send, notify, myName }) {
  const list = []; // { key, name, x, z, until, group, mark }
  const geo = new THREE.CylinderGeometry(0.7, 0.7, 70, 10, 1, true);
  const tex = (() => {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  ctx.mapMarks ??= [];

  function put(key, name, x, z, color) {
    let r = list.find((o) => o.key === key);
    if (!r) {
      if (list.length >= MAX) remove(list[0]);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color, transparent: true, opacity: 0.6, fog: false,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const group = new THREE.Mesh(geo, mat);
      group.frustumCulled = false;
      group.userData.noShadow = true;
      ctx.scene.add(group);
      const mark = { emoji: '📍', color: `#${new THREE.Color(color).getHexString()}` };
      ctx.mapMarks.push(mark);
      r = { key, group, mark };
      list.push(r);
    }
    const y = Math.max(0, ctx.terrainHeight?.(x, z) ?? 0);
    r.group.position.set(x, y + 35, z);
    Object.assign(r, { name, x, z, until: Date.now() + TTL });
    Object.assign(r.mark, { x, z, label: `RDV ${name}`, hidden: false });
  }

  function remove(r) {
    ctx.scene.remove(r.group);
    r.group.material.dispose();
    const i = ctx.mapMarks.indexOf(r.mark);
    if (i >= 0) ctx.mapMarks.splice(i, 1);
    list.splice(list.indexOf(r), 1);
  }

  let t = 0;
  ctx.updatables.push((dt) => {
    if (!list.length) return;
    t += dt;
    const now = Date.now();
    for (const r of [...list]) {
      if (now > r.until) { remove(r); continue; }
      const fade = Math.min(1, (r.until - now) / 10000);
      r.group.material.opacity = (0.45 + Math.sin(t * 4) * 0.15) * fade;
    }
  });

  return {
    // Rendez-vous que JE pose (depuis la carte)
    mine(x, z) {
      put('moi', myName() ?? 'moi', x, z, 0xff3df0);
      send({ t: 'rdv', x, z });
      notify('📍 Rendez-vous envoyé à tous les joueurs !');
    },
    // Reçu du serveur
    receive(msg, color) {
      put(msg.id, msg.name, msg.x, msg.z, color ?? 0x00ffd5);
      notify(`📍 ${msg.name} donne rendez-vous ! (carte : touche M)`);
    },
  };
}
