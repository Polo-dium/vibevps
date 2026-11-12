import * as THREE from 'three';

// IMPACTS DE BALLES — tout le spectacle d'un tir qui touche le décor, en
// TROIS draw calls quel que soit le nombre de balles :
//  - étincelles (Points additifs, 180 en réserve) : gerbe orientée par la
//    normale du mur, franche sur la tôle, discrète sur la pierre
//  - poussière (Points alpha, 48 en réserve) : petit nuage qui s'étale sur
//    le béton, la pierre et le sol
//  - trous (InstancedMesh, les 72 derniers) : pastille sombre à bord
//    écaillé, plaquée sur la surface, qui reste jusqu'à être recyclée
// Avant, chaque impact ajoutait 8 maillages à la scène (8 draw calls).

const SPARKS = 180, DUST = 48, HOLES = 72;
const FAR = -9999;

function dotTexture(soft) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(soft ? 0.25 : 0.5, `rgba(255,255,255,${soft ? 0.55 : 0.9})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Trou de balle : cœur noir, couronne sombre irrégulière, éclats clairs
function holeTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 69;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  g.translate(S / 2, S / 2);
  g.fillStyle = 'rgba(20,18,16,0.55)';
  g.beginPath();
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * Math.PI * 2, r = 15 + rnd() * 11;
    g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  g.fill();
  g.strokeStyle = 'rgba(235,230,220,0.5)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2, r0 = 9 + rnd() * 4, r1 = r0 + 5 + rnd() * 9;
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    g.lineTo(Math.cos(a + 0.1) * r1, Math.sin(a + 0.1) * r1);
    g.stroke();
  }
  const core = g.createRadialGradient(0, 0, 0, 0, 0, 10);
  core.addColorStop(0, 'rgba(0,0,0,1)');
  core.addColorStop(0.7, 'rgba(8,7,6,0.95)');
  core.addColorStop(1, 'rgba(8,7,6,0)');
  g.fillStyle = core;
  g.beginPath();
  g.arc(0, 0, 10, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function pool(n, material) {
  const pos = new Float32Array(n * 3).fill(FAR);
  const col = new Float32Array(n * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const pts = new THREE.Points(geo, material);
  pts.frustumCulled = false;
  pts.userData.noShadow = true;
  return {
    pts, pos, col, n, next: 0,
    vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n),
    rgb: new Float32Array(n * 3), live: 0,
  };
}

export function createImpacts(scene) {
  const sparks = pool(SPARKS, new THREE.PointsMaterial({
    size: 0.09, map: dotTexture(false), vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  const dust = pool(DUST, new THREE.PointsMaterial({
    size: 0.7, map: dotTexture(true), vertexColors: true, transparent: true,
    depthWrite: false, sizeAttenuation: true,
  }));
  scene.add(sparks.pts, dust.pts);

  const holes = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: holeTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }),
    HOLES
  );
  holes.frustumCulled = false;
  holes.userData.noShadow = true;
  holes.count = 0;
  scene.add(holes);
  let holeNext = 0;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const _s = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);

  function emit(P, x, y, z, vx, vy, vz, life, r, g, b) {
    const i = P.next;
    P.next = (P.next + 1) % P.n;
    P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
    P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
    P.life[i] = P.max[i] = life;
    P.rgb[i * 3] = r; P.rgb[i * 3 + 1] = g; P.rgb[i * 3 + 2] = b;
    P.live = Math.max(P.live, 1);
  }

  // point : Vector3 ; normal : Vector3 (ou null = en l'air / sur un
  // personnage) ; kind : 'metal' | 'mur' | 'sol'
  function spawn(point, normal = null, kind = 'mur') {
    const n = normal ?? _n.set(0, 1, 0);
    const metal = kind === 'metal';
    const count = normal ? (metal ? 11 : 5) : 4;
    for (let i = 0; i < count; i++) {
      // gerbe dans le demi-espace de la normale
      const sp = metal ? 5.5 : 3.2;
      const vx = n.x * sp * (0.4 + Math.random()) + (Math.random() - 0.5) * sp;
      const vy = n.y * sp * (0.4 + Math.random()) + (Math.random() - 0.3) * sp * 0.8;
      const vz = n.z * sp * (0.4 + Math.random()) + (Math.random() - 0.5) * sp;
      const hot = Math.random();
      emit(sparks, point.x, point.y, point.z, vx, vy, vz, 0.16 + Math.random() * (metal ? 0.3 : 0.16),
        1, 0.62 + hot * 0.33, 0.25 + hot * 0.45);
    }
    if (!normal) return;
    if (!metal) {
      const tone = kind === 'sol' ? 0.5 : 0.72;
      for (let i = 0; i < 2; i++) {
        emit(dust, point.x + n.x * 0.1, point.y + n.y * 0.1, point.z + n.z * 0.1,
          n.x * (0.5 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.5,
          n.y * 0.5 + 0.35 + Math.random() * 0.3,
          n.z * (0.5 + Math.random() * 0.6) + (Math.random() - 0.5) * 0.5,
          0.55 + Math.random() * 0.35, tone, tone * 0.96, tone * 0.9);
      }
    }
    // Trou plaqué sur la surface (roulis et taille au hasard)
    const size = (metal ? 0.11 : 0.17) * (0.8 + Math.random() * 0.5);
    _q.setFromUnitVectors(Z, n);
    _q2.setFromAxisAngle(Z, Math.random() * Math.PI * 2);
    _m.compose(_p.copy(point).addScaledVector(n, 0.006), _q.multiply(_q2), _s.set(size, size, 1));
    holes.setMatrixAt(holeNext, _m);
    holeNext = (holeNext + 1) % HOLES;
    holes.count = Math.min(HOLES, holes.count + 1);
    holes.instanceMatrix.needsUpdate = true;
  }

  function step(P, dt, gravity, drag, fadeAlpha) {
    if (!P.live) return;
    let live = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      P.life[i] -= dt;
      const k = Math.max(0, P.life[i] / P.max[i]);
      if (P.life[i] <= 0) {
        P.pos[i * 3 + 1] = FAR;
        P.col[i * 4 + 3] = 0;
        continue;
      }
      live++;
      P.vel[i * 3 + 1] -= gravity * dt;
      const d = Math.exp(-drag * dt);
      P.vel[i * 3] *= d; P.vel[i * 3 + 2] *= d;
      P.pos[i * 3] += P.vel[i * 3] * dt;
      P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt;
      P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      P.col[i * 4] = P.rgb[i * 3]; P.col[i * 4 + 1] = P.rgb[i * 3 + 1]; P.col[i * 4 + 2] = P.rgb[i * 3 + 2];
      P.col[i * 4 + 3] = fadeAlpha * k;
    }
    P.live = live;
    P.pts.geometry.attributes.position.needsUpdate = true;
    P.pts.geometry.attributes.color.needsUpdate = true;
  }

  function update(dt) {
    step(sparks, dt, 11, 1.2, 1);
    step(dust, dt, -0.2, 2.6, 0.38);
  }

  return { spawn, update };
}
