import * as THREE from 'three';
import { hashColor } from '../world/utils.js';
import * as net from '../net.js';

const INTERP_DELAY = 0.12; // secondes de retard de rendu pour interpoler

export function createRemotePlayers(scene, shootables, { onHitRemote } = {}) {
  const remotes = new Map(); // id -> { group, body, head, buffer, name, flashUntil, baseColor }

  function spawn(id, name, p, ry) {
    if (remotes.has(id)) return;
    const group = new THREE.Group();
    const baseColor = hashColor(name);

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 0.85, 4, 10),
      new THREE.MeshLambertMaterial({ color: baseColor })
    );
    body.position.y = 0.95;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 12, 10),
      new THREE.MeshLambertMaterial({ color: 0xe8c39e })
    );
    head.position.y = 1.62;
    group.add(head);

    // Visière (indique la direction du regard)
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.08, 0.1),
      new THREE.MeshLambertMaterial({ color: 0x222222 })
    );
    visor.position.set(0, 1.64, -0.18);
    group.add(visor);

    group.add(makeNameplate(name));
    group.position.set(p[0], p[1], p[2]);
    group.rotation.y = ry;
    scene.add(group);

    // Le corps et la tête peuvent être touchés par les balles (PvP)
    for (const mesh of [body, head]) {
      mesh.userData.onHit = () => onHitRemote?.(id);
      shootables?.push(mesh);
    }

    remotes.set(id, {
      group, body, head, name, baseColor,
      buffer: [{ t: performance.now() / 1000, p, ry }],
      flashUntil: 0,
    });
  }

  function remove(id) {
    const r = remotes.get(id);
    if (!r) return;
    scene.remove(r.group);
    if (shootables) {
      for (const mesh of [r.body, r.head]) {
        const i = shootables.indexOf(mesh);
        if (i !== -1) shootables.splice(i, 1);
      }
    }
    remotes.delete(id);
  }

  function flash(id) {
    const r = remotes.get(id);
    if (!r) return;
    r.body.material.color.set(0xff2222);
    r.flashUntil = performance.now() / 1000 + 0.25;
  }

  net.on('hello', (msg) => {
    for (const pl of msg.players) spawn(pl.id, pl.name, pl.p, pl.ry);
  });
  net.on('pjoin', (msg) => spawn(msg.id, msg.name, msg.p, msg.ry));
  net.on('pleave', (msg) => remove(msg.id));
  net.on('hp', (msg) => flash(msg.id));
  net.on('death', (msg) => flash(msg.id));
  net.on('states', (msg) => {
    const now = performance.now() / 1000;
    for (const [id, x, y, z, ry] of msg.s) {
      const r = remotes.get(id);
      if (!r) continue;
      r.buffer.push({ t: now, p: [x, y, z], ry });
      if (r.buffer.length > 30) r.buffer.shift();
    }
  });

  function update() {
    const renderTime = performance.now() / 1000 - INTERP_DELAY;
    const now = performance.now() / 1000;
    for (const r of remotes.values()) {
      if (r.flashUntil && now > r.flashUntil) {
        r.body.material.color.copy(r.baseColor);
        r.flashUntil = 0;
      }
      const buf = r.buffer;
      if (buf.length === 0) continue;
      let a = buf[0], b = buf[buf.length - 1];
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= renderTime) {
          a = buf[i];
          b = buf[Math.min(i + 1, buf.length - 1)];
          break;
        }
      }
      const span = b.t - a.t;
      const alpha = span > 0 ? Math.min(1, (renderTime - a.t) / span) : 1;
      r.group.position.set(
        a.p[0] + (b.p[0] - a.p[0]) * alpha,
        a.p[1] + (b.p[1] - a.p[1]) * alpha,
        a.p[2] + (b.p[2] - a.p[2]) * alpha
      );
      // Interpolation d'angle (chemin le plus court)
      let dry = b.ry - a.ry;
      while (dry > Math.PI) dry -= Math.PI * 2;
      while (dry < -Math.PI) dry += Math.PI * 2;
      r.group.rotation.y = a.ry + dry * alpha;
    }
  }

  function count() { return remotes.size; }

  return { update, count };
}

function makeNameplate(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = 'bold 34px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#000';
  g.shadowBlur = 8;
  g.fillStyle = '#ffffff';
  g.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
  );
  sprite.scale.set(1.8, 0.45, 1);
  sprite.position.y = 2.15;
  return sprite;
}
