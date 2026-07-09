import * as THREE from 'three';

// La Quenelle dorée : un collectible qui apparaît toutes les 5 minutes à un
// endroit différent de la ville. Le tour de rotation est calé sur Date.now()
// (même horloge pour tous, zéro trafic réseau — le motif du cycle jour/nuit
// et du silure). Premier gone sur place l'empoche : le serveur arbitre
// (un seul gagnant par tour), crédite l'XP et l'annonce à tout le monde.
const ROUND_MS = 5 * 60 * 1000;
const GRAB_R = 4; // rayon de ramassage (m)

// Emplacements dérivés des points d'intérêt du décor : déterministes chez
// tous les joueurs (le monde est seedé), avec un décalage pour ne pas
// tomber PILE sur la statue/la borne mais à côté.
function buildSpots(ctx) {
  const seen = new Set();
  const spots = [];
  for (const p of ctx.pois ?? []) {
    const name = p.nom ?? p.name ?? '?';
    if (seen.has(name)) continue; // certains POI existent en double (Jetpack…)
    seen.add(name);
    spots.push({ x: p.x + 6, z: p.z + 5, hint: name });
  }
  // Toujours au moins un spot, même sans POI (monde minimal des tests)
  if (!spots.length) spots.push({ x: 10, z: 10, hint: 'Bellecour' });
  return spots;
}

export function createQuenelle(ctx, { send, notify, onWin }) {
  const spots = buildSpots(ctx);

  // La quenelle : ellipsoïde doré étiré (LA forme officielle du gratin),
  // avec un halo additif — pas de vraie lumière, règle perf oblige.
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xf5c542, emissive: 0x9a7411 })
  );
  body.scale.set(1, 0.42, 0.42);
  body.rotation.z = 0.35; // penchée, l'air noble
  group.add(body);
  const glowTex = makeGlowTexture();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffd97a, transparent: true, opacity: 0.75,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.set(3.2, 3.2, 1);
  group.add(glow);
  group.traverse((o) => { o.userData.noShadow = true; });
  group.visible = false;
  ctx.scene.add(group);

  const roundOf = () => Math.floor(Date.now() / ROUND_MS);
  // Mélange le choix du spot d'un tour à l'autre (pas un simple modulo qui
  // ferait toujours la même tournée dans le même ordre)
  const spotFor = (round) => spots[((round * 2654435761) >>> 0) % spots.length];

  let shownRound = -1;
  let claimedRound = -1;
  let t = 0;

  const inter = { x: 0, z: 0, r: 0, label: 'E — Ramasser la Quenelle dorée', action: grab };
  ctx.interactables.push(inter);

  function place(round) {
    const s = spotFor(round);
    const y = Math.max(0, ctx.terrainHeight?.(s.x, s.z) ?? 0);
    group.position.set(s.x, y + 1.1, s.z);
    group.visible = true;
    inter.x = s.x;
    inter.z = s.z;
    inter.r = GRAB_R;
    return s;
  }

  function grab() {
    const round = roundOf();
    if (claimedRound === round || !group.visible) return;
    send({ t: 'quenelle', round });
  }

  // Réponses serveur : gagnant du tour (broadcast) ou « trop tard » (perso)
  function applyServerMsg(msg) {
    if (msg.taken) {
      notify('🥈 Trop tard gone, la quenelle vient d’être chopée !');
      return;
    }
    // Le tour du serveur peut différer du nôtre d'un cran (horloges) : on
    // n'ignore que les annonces franchement anciennes.
    if (Number(msg.round) < shownRound - 1) return;
    claimedRound = Number(msg.round);
    group.visible = false;
    inter.r = 0;
    if (msg.mine) onWin?.(msg);
    else notify(`🥇 ${msg.by} a gagné la Quenelle dorée ! Prochaine dans quelques minutes…`);
  }

  ctx.updatables.push((dt) => {
    const round = roundOf();
    if (round !== shownRound) {
      shownRound = round;
      const s = place(round);
      if (claimedRound !== round) {
        notify(`✨ Une Quenelle dorée est apparue près de : ${s.hint} ! Premier arrivé, premier servi.`);
      } else {
        group.visible = false; // déjà gagnée pendant qu'on chargeait
        inter.r = 0;
      }
    }
    if (!group.visible) return;
    t += dt;
    group.rotation.y = t * 1.4;
    group.position.y += Math.sin(t * 2.2) * dt * 0.35; // flottement doux
    glow.material.opacity = 0.6 + Math.sin(t * 3) * 0.15;
  });

  return { applyServerMsg };
}

function makeGlowTexture() {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,230,150,1)');
  grad.addColorStop(0.4, 'rgba(255,210,100,0.35)');
  grad.addColorStop(1, 'rgba(255,200,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
