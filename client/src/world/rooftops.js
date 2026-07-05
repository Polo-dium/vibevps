import * as THREE from 'three';
import { buildHuman } from './human.js';

// Rooftop bars : sur quelques grands toits, une terrasse festive — comptoir,
// tabourets, transats, parasols, plantes, guirlandes lumineuses (la nuit) et
// des gones qui sirotent un canon en admirant la vue. Purement décoratif :
// aucune synchro réseau, chaque client anime sa propre terrasse.

const SHIRTS = [0xd94f7a, 0x4da6ff, 0xffd23f, 0x4dff6a, 0xff7a4d, 0xc44dff, 0xe8e6df];
const CHILL_PHRASES = [
  'La vue est folle d’ici !', 'Un canon de côtes, gone ?', 'Santé les gones !',
  'On est bien, là-haut.', 'Regarde Fourvière au coucher…', 'Le meilleur rooftop de Lyon.',
  'À la tienne !', 'Ça caille pas trop, ça va.',
];

// Construit une terrasse sur le toit défini par son centre (x,z), sa hauteur
// (y = niveau du toit) et son emprise (w,d). Ajoute un acrotère de collision
// pour ne pas tomber. Renvoie une fonction d'update.
export function buildRooftopBar(ctx, { x, z, y, w, d, rand }) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  ctx.scene.add(g);

  const woodMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x8a7355 });
  const metalMat = new THREE.MeshLambertMaterial({ color: 0x30343c });

  // Platelage bois qui couvre le toit
  const deck = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 0.12, d - 0.4), deckMat);
  deck.position.y = 0.06;
  g.add(deck);

  // Acrotère : muret sur le pourtour (visuel + collision anti-chute)
  const PH = 1.05;
  const railMat = new THREE.MeshLambertMaterial({ color: 0xb7b0a2 });
  const halfW = w / 2, halfD = d / 2;
  for (const [sx, sz, ww, dd] of [
    [0, -halfD, w, 0.3], [0, halfD, w, 0.3],
    [-halfW, 0, 0.3, d], [halfW, 0, 0.3, d],
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(ww, PH, dd), railMat);
    bar.position.set(sx, PH / 2, sz);
    g.add(bar);
    ctx.colliders.push({
      minX: x + sx - ww / 2, maxX: x + sx + ww / 2,
      minY: y, maxY: y + PH,
      minZ: z + sz - dd / 2, maxZ: z + sz + dd / 2,
    });
  }

  // Comptoir de bar avec bouteilles colorées, adossé à un bord
  const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 1.05, 0.7), woodMat);
  bar.position.set(-w * 0.2, 0.6, -halfD + 1.2);
  g.add(bar);
  const top = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4 + 0.2, 0.1, 0.9), deckMat);
  top.position.set(-w * 0.2, 1.15, -halfD + 1.2);
  g.add(top);
  const bottleCols = [0x4dff6a, 0xff5252, 0xffd23f, 0x4da6ff, 0xff7a4d];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 0.28, 6),
      new THREE.MeshLambertMaterial({ color: bottleCols[i % bottleCols.length] })
    );
    b.position.set(-w * 0.2 - w * 0.15 + i * (w * 0.06), 1.34, -halfD + 1.2);
    g.add(b);
  }

  // Tabourets devant le bar
  for (let i = 0; i < 3; i++) {
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 8), metalMat);
    stool.position.set(-w * 0.32 + i * (w * 0.13), 0.62, -halfD + 2.1);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6), metalMat);
    leg.position.set(stool.position.x, 0.3, stool.position.z);
    g.add(stool, leg);
  }

  // Parasols + transats répartis sur la terrasse
  const parasolCols = [0xd94f7a, 0x4da6ff, 0xffd23f, 0x4dff6a];
  const loungeSpots = [];
  const nSets = Math.max(2, Math.floor((w * d) / 90));
  for (let i = 0; i < nSets; i++) {
    const px = (rand() - 0.5) * (w - 3);
    const pz = halfD - 2 - rand() * (d - 5);
    // Parasol
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), metalMat);
    pole.position.set(px, 1.1, pz);
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, 0.6, 8),
      new THREE.MeshLambertMaterial({ color: parasolCols[i % parasolCols.length] })
    );
    canopy.position.set(px, 2.4, pz);
    g.add(pole, canopy);
    // Transat (bain de soleil incliné)
    const chair = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 1.4), woodMat);
    seat.position.y = 0.35;
    chair.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.7), woodMat);
    back.position.set(0, 0.6, -0.75);
    back.rotation.x = -0.7;
    chair.add(back);
    chair.position.set(px + 1.2, 0, pz);
    chair.rotation.y = rand() * 0.6 - 0.3;
    g.add(chair);
    loungeSpots.push({ x: px + 1.2, z: pz, lounging: true, ry: chair.rotation.y });
    // Petite plante en pot
    if (rand() < 0.6) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.35, 8), new THREE.MeshLambertMaterial({ color: 0x9a5a3a }));
      pot.position.set(px - 1.4, 0.18, pz);
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), new THREE.MeshLambertMaterial({ color: 0x4a7038, flatShading: true }));
      bush.position.set(px - 1.4, 0.6, pz);
      g.add(pot, bush);
    }
  }

  // Guirlande lumineuse le long de l'acrotère (points additifs, la nuit)
  const bulbPos = [];
  const per = Math.max(4, Math.floor(w));
  for (let i = 0; i <= per; i++) {
    const t = i / per;
    bulbPos.push(-halfW + t * w, PH + 0.15 + Math.sin(t * Math.PI * 3) * 0.15, -halfD + 0.2);
    bulbPos.push(-halfW + t * w, PH + 0.15 + Math.sin(t * Math.PI * 3) * 0.15, halfD - 0.2);
  }
  const garlandGeo = new THREE.BufferGeometry();
  garlandGeo.setAttribute('position', new THREE.Float32BufferAttribute(bulbPos, 3));
  const garlandMat = new THREE.PointsMaterial({
    color: 0xffd98a, size: 0.5, sizeAttenuation: true,
    transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const garland = new THREE.Points(garlandGeo, garlandMat);
  garland.userData.noShadow = true;
  g.add(garland);

  // --- Gones qui se prélassent -------------------------------------------
  const people = [];
  // Un barman debout derrière le comptoir
  const spots = [{ x: -w * 0.2, z: -halfD + 0.7, ry: 0, lounging: false }, ...loungeSpots];
  const nPeople = Math.min(spots.length, 2 + Math.floor(rand() * 3));
  for (let i = 0; i < nPeople; i++) {
    const s = spots[i];
    const human = buildHuman({
      shirt: SHIRTS[Math.floor(rand() * SHIRTS.length)],
      pants: [0x39404e, 0x4e4439, 0x2e3a4e][Math.floor(rand() * 3)],
      hair: rand() < 0.5 ? 0x3a2c1e : 0x55514c,
    });
    const hg = human.group;
    hg.position.set(s.x, 0, s.z);
    hg.rotation.y = s.ry ?? 0;
    if (s.lounging) {
      // Allongé sur le transat : couché sur le dos, un peu relevé
      hg.rotation.x = -1.15;
      hg.position.y = 0.5;
      human.animate(0, 0);
      // Bras qui tient un verre
      const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.04, 0.12, 6),
        new THREE.MeshLambertMaterial({ color: 0xffe14d, transparent: true, opacity: 0.8 })
      );
      glass.position.set(0.32, 1.1, -0.2);
      hg.add(glass);
    } else {
      human.animate(0, 0);
    }
    // Shootable pour l'ambiance (réagit aux tirs comme les autres PNJ)
    for (const mesh of human.hitMeshes) ctx.shootables.push(mesh);
    g.add(hg);
    people.push({ human, phase: rand() * 10, lounging: s.lounging });
  }

  // Bulle de dialogue partagée (une à la fois par terrasse)
  const bubble = makeBubble();
  bubble.visible = false;
  g.add(bubble);
  let bubbleT = 4 + rand() * 8;

  const night = () => ctx.env?.night ?? 0;
  return function update(dt) {
    garlandMat.opacity = 0.1 + Math.max(0, night() * 1.2 - 0.2) * 0.85;
    for (const p of people) {
      p.phase += dt;
      if (!p.lounging) {
        // Léger balancement idle debout
        p.human.group.rotation.z = Math.sin(p.phase * 1.5) * 0.03;
      }
    }
    bubbleT -= dt;
    if (bubbleT <= 0 && people.length) {
      const p = people[Math.floor(rand() * people.length)];
      setBubble(bubble, CHILL_PHRASES[Math.floor(rand() * CHILL_PHRASES.length)]);
      bubble.position.set(p.human.group.position.x, 2.4, p.human.group.position.z);
      bubble.visible = true;
      bubbleT = -1;
      setTimeout(() => { bubble.visible = false; }, 3000);
      bubbleT = 6 + rand() * 10;
    }
  };
}

function makeBubble() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false,
  }));
  sprite.scale.set(3.4, 0.85, 1);
  sprite.userData.canvas = canvas;
  return sprite;
}

function setBubble(sprite, text) {
  const canvas = sprite.userData.canvas;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.font = '600 38px "Segoe UI", sans-serif';
  const w = Math.min(490, c.measureText(text).width + 50);
  const x = (canvas.width - w) / 2;
  c.fillStyle = 'rgba(255,255,255,0.93)';
  c.beginPath();
  c.roundRect(x, 18, w, 78, 20);
  c.fill();
  c.fillStyle = '#1a2233';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, canvas.width / 2, 58, 470);
  sprite.material.map.needsUpdate = true;
}
