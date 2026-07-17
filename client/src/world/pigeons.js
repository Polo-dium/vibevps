import * as THREE from 'three';

// Les PIGEONS 🐦 : ils picorent sur les places, et s'envolent en nuage
// quand un joueur leur court dedans — puis reviennent picorer un peu plus
// loin. Trois volées de 8, animation à la main, coût minuscule.
const FLOCK = 8;
const SCARE_R = 6;

function makePigeon() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 7, 5),
    new THREE.MeshLambertMaterial({ color: 0x8b93a1 })
  );
  body.scale.set(1, 0.85, 1.35);
  body.position.y = 0.1;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 6, 4),
    new THREE.MeshLambertMaterial({ color: 0x5d6675 })
  );
  head.position.set(0, 0.19, -0.11);
  g.add(head);
  g.userData.head = head;
  return g;
}

export function createPigeons(ctx) {
  const spots = [];
  const B = ctx.bellecourRect;
  if (B) spots.push([(B.minX + B.maxX) / 2 - 20, (B.minZ + B.maxZ) / 2 + 8]);
  else spots.push([-14, 18]);
  const roue = ctx.pois?.find((p) => p.id === 'roue');
  if (roue) spots.push([roue.x - 10, roue.z - 8]);
  const bouchon = ctx.pois?.find((p) => p.id === 'bouchon');
  if (bouchon) spots.push([bouchon.x + 10, bouchon.z + 6]);

  const flocks = [];
  for (const [fx, fz] of spots.slice(0, 3)) {
    const birds = [];
    for (let i = 0; i < FLOCK; i++) {
      const g = makePigeon();
      const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 3;
      const home = [fx + Math.cos(a) * r, fz + Math.sin(a) * r];
      g.position.set(home[0], Math.max(0, ctx.terrainHeight?.(home[0], home[1]) ?? 0), home[1]);
      g.rotation.y = Math.random() * Math.PI * 2;
      ctx.scene.add(g);
      birds.push({
        g, home, t: Math.random() * 10,
        fly: 0, // > 0 : en vol de panique
        flyDir: Math.random() * Math.PI * 2,
      });
    }
    flocks.push({ x: fx, z: fz, birds });
  }

  ctx.updatables.push((dt) => {
    const p = ctx.playerPos();
    for (const flock of flocks) {
      // pas de calcul si le joueur est loin de la place
      const near = Math.hypot(p.x - flock.x, p.z - flock.z) < 40;
      for (const b of flock.birds) {
        b.t += dt;
        if (b.fly > 0) {
          // Panique : il monte en spirale, puis revient se poser plus loin
          b.fly -= dt;
          b.flyDir += dt * 1.4;
          const climb = Math.min(1, (5 - b.fly) * 1.2);
          b.g.position.x += Math.sin(b.flyDir) * 6 * dt;
          b.g.position.z += Math.cos(b.flyDir) * 6 * dt;
          b.g.position.y += (climb * 7 - (5 - b.fly) * 1.1) * dt * 2;
          b.g.rotation.y = b.flyDir;
          b.g.rotation.z = Math.sin(b.t * 26) * 0.5; // battement frénétique
          if (b.fly <= 0) {
            const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 4;
            b.home = [flock.x + Math.cos(a) * r, flock.z + Math.sin(a) * r];
            b.g.position.set(b.home[0], Math.max(0, ctx.terrainHeight?.(b.home[0], b.home[1]) ?? 0), b.home[1]);
            b.g.rotation.z = 0;
          }
          continue;
        }
        if (!near) continue;
        // Picorage : la tête plonge, petit sautillement de temps en temps
        b.g.userData.head.position.y = 0.19 - Math.max(0, Math.sin(b.t * 3.1)) * 0.1;
        if (Math.sin(b.t * 0.7) > 0.995) b.g.rotation.y += 0.8;
        // Un joueur fonce dedans → toute la volée décolle
        if (Math.hypot(p.x - b.g.position.x, p.z - b.g.position.z) < SCARE_R) {
          for (const other of flock.birds) {
            if (other.fly <= 0) {
              other.fly = 4 + Math.random() * 2;
              other.flyDir = Math.atan2(other.g.position.x - p.x, other.g.position.z - p.z)
                + (Math.random() - 0.5);
            }
          }
        }
      }
    }
  });
}
