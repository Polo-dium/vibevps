import * as THREE from 'three';

// SANG (arène et ville) : gerbe de gouttes à chaque balle qui touche un
// personnage, flaque qui s'étale sous un corps tombé. Deux draw calls en
// tout : un nuage de Points (220 gouttes recyclées) et un InstancedMesh de
// 12 flaques. Aucune texture chargée, aucune lumière.
// Coupable d'un clic : localStorage lyon_gore = '0'.
const DROPS = 220, POOLS = 12;

export function createGore(scene, { groundAt } = {}) {
  const enabled = () => localStorage.getItem('lyon_gore') !== '0';
  const pos = new Float32Array(DROPS * 3).fill(-9999);
  const vel = new Float32Array(DROPS * 3);
  const life = new Float32Array(DROPS);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const g = dot.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(dot);
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    map: tex, color: 0x8f0a0a, size: 0.085, sizeAttenuation: true, transparent: true, depthWrite: false,
  }));
  points.frustumCulled = false;
  points.userData.noShadow = true;
  scene.add(points);
  let next = 0, live = 0;

  const poolGeo = new THREE.CircleGeometry(1, 18);
  poolGeo.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({
    map: tex, color: 0x5c0606, transparent: true, opacity: 0.85, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  }), POOLS);
  pools.count = 0;
  pools.frustumCulled = false;
  pools.userData.noShadow = true;
  scene.add(pools);
  const poolData = []; // { x, y, z, born, r }
  let poolNext = 0;
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

  return {
    // gerbe au point d'impact ; (dx, dz) = sens de la balle
    burst(x, y, z, dx = 0, dz = 0, n = 14) {
      if (!enabled()) return;
      for (let i = 0; i < n; i++) {
        const o = next * 3;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
        vel[o] = dx * (1.5 + Math.random() * 3) + (Math.random() - 0.5) * 2.4;
        vel[o + 1] = 0.6 + Math.random() * 2.6;
        vel[o + 2] = dz * (1.5 + Math.random() * 3) + (Math.random() - 0.5) * 2.4;
        life[next] = 0.5 + Math.random() * 0.5;
        next = (next + 1) % DROPS;
      }
      live = 1.2;
    },
    // flaque sous un corps
    pool(x, y, z) {
      if (!enabled()) return;
      poolData[poolNext] = { x, y: y + 0.06, z, born: performance.now(), r: 0.55 + Math.random() * 0.35 };
      poolNext = (poolNext + 1) % POOLS;
      pools.count = Math.min(POOLS, poolData.length);
    },
    update(dt) {
      if (live > 0) {
        live -= dt;
        for (let i = 0; i < DROPS; i++) {
          if (life[i] <= 0) continue;
          const o = i * 3;
          life[i] -= dt;
          vel[o + 1] -= 11 * dt;
          pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
          const gy = (groundAt?.(pos[o], pos[o + 2]) ?? 0) + 0.03;
          if (life[i] <= 0 || pos[o + 1] < gy) { life[i] = 0; pos[o + 1] = -9999; }
        }
        geo.attributes.position.needsUpdate = true;
      }
      if (pools.count) {
        const now = performance.now();
        for (let i = 0; i < pools.count; i++) {
          const d = poolData[i];
          const age = (now - d.born) / 1000;
          // s'étale en 2,5 s, s'efface entre 30 et 40 s
          const grow = Math.min(1, age / 2.5), fade = age > 30 ? Math.max(0, 1 - (age - 30) / 10) : 1;
          const r = d.r * (0.25 + 0.75 * grow) * fade;
          _m.compose(_p.set(d.x, d.y, d.z), _q, _s.set(r, 1, r));
          pools.setMatrixAt(i, _m);
        }
        pools.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
