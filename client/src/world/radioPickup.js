import * as THREE from 'three';
import { ARCADE } from './layout.js';

// La radio est volontairement placée devant la salle d'arcade : un repère
// facile à décrire par Momo, mais assez loin de la Grande Roue pour créer une
// vraie petite mission. Le point reste identique dans les deux modes de ville.
export const RADIO_SPOT = { x: ARCADE.x - 10, z: ARCADE.z + 14 };

export function buildRadioPickup(ctx, { hasItem, onPickup }) {
  const groundY = ctx.terrainHeight?.(RADIO_SPOT.x, RADIO_SPOT.z) ?? 0;
  const group = new THREE.Group();
  const model = buildRadioModel();
  model.scale.setScalar(2.8);
  group.add(model);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    color: 0xff59de,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  glow.position.y = -0.55;
  glow.scale.set(3, 3, 1);
  group.add(glow);

  const label = makeLabel();
  label.position.y = 1.25;
  group.add(label);
  group.position.set(RADIO_SPOT.x, groundY + 1.05, RADIO_SPOT.z);
  ctx.scene.add(group);

  let t = 0;
  let picked = Boolean(hasItem?.('radio'));
  group.visible = !picked;
  ctx.updatables.push((dt) => {
    if (picked || hasItem?.('radio')) {
      picked = true;
      group.visible = false;
      return;
    }
    t += dt;
    group.rotation.y = t * 1.2;
    group.position.y = groundY + 1.05 + Math.sin(t * 2) * 0.12;
    const p = ctx.playerPos?.();
    if (!p || Math.hypot(p.x - RADIO_SPOT.x, p.z - RADIO_SPOT.z) >= 1.8 ||
        Math.abs(p.y - groundY) >= 2.2) return;
    picked = true;
    group.visible = false;
    onPickup?.();
  });

  function target(from = ctx.playerPos?.()) {
    const dx = RADIO_SPOT.x - (from?.x ?? 0);
    const dz = RADIO_SPOT.z - (from?.z ?? 0);
    return { ...RADIO_SPOT, distance: Math.hypot(dx, dz) };
  }

  return { target };
}

function buildRadioModel() {
  const group = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x23262d });
  const grey = new THREE.MeshLambertMaterial({ color: 0x626b78 });
  const accent = new THREE.MeshLambertMaterial({ color: 0xff3df0, emissive: 0x3a082f });
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.14), dark));
  for (const dx of [-0.1, 0.1]) {
    const speaker = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.025, 10), grey);
    speaker.rotation.x = Math.PI / 2;
    speaker.position.set(dx, -0.02, 0.08);
    group.add(speaker);
  }
  const display = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.035, 0.018), accent);
  display.position.set(0, 0.045, 0.081);
  group.add(display);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.018, 5, 10, Math.PI), grey);
  handle.rotation.set(Math.PI / 2, 0, 0);
  handle.position.set(0, 0.14, 0);
  group.add(handle);
  return group;
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,.95)');
  grad.addColorStop(.42, 'rgba(255,89,222,.5)');
  grad.addColorStop(1, 'rgba(255,89,222,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 72;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(6,10,22,.88)';
  g.beginPath(); g.roundRect(8, 8, 240, 56, 12); g.fill();
  g.strokeStyle = '#ff59de'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#ffd9f7'; g.font = '800 25px monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('📻 RADIO', 128, 37);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false,
  }));
  sprite.scale.set(2.8, 0.8, 1);
  return sprite;
}
