import * as THREE from 'three';

// OMBRES DE CONTACT : une tache sombre et douce sous chaque personnage
// réaliste, pour les paliers où ils ne portent pas de vraie ombre (tout sauf
// Élevé). UN InstancedMesh pour tous (64 au plus, les plus proches du
// joueur d'abord dans l'ordre de la liste) : un draw call, zéro carte
// d'ombre. La liste des groupes vient d'avatars.js (avatarStats.groups).
const MAX = 64;

export function createBlobShadows(scene, { groups, getViewer }) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }), MAX);
  mesh.frustumCulled = false;
  mesh.userData.noShadow = true;
  mesh.count = 0;
  scene.add(mesh);
  const m = new THREE.Matrix4();
  const seen = new WeakSet();

  // À appeler une fois par image, après les animations
  function update() {
    const v = getViewer();
    let n = 0;
    for (let i = groups.length - 1; i >= 0; i--) {
      const gr = groups[i];
      if (!gr.parent) {
        // retiré de la scène (joueur parti, PNJ remplacé) : on l'oublie
        if (seen.has(gr)) groups.splice(i, 1);
        continue;
      }
      seen.add(gr);
      if (n >= MAX || !gr.visible || gr.parent.visible === false) continue;
      const e = gr.matrixWorld.elements;
      const dx = e[12] - v.x, dz = e[14] - v.z;
      if (dx * dx + dz * dz > 1600) continue; // 40 m
      // un corps couché (mort, transat) étale son ombre
      const lying = Math.abs(gr.rotation.x) > 0.6;
      const s = lying ? 1.9 : 1.05;
      m.makeScale(s, 1, s);
      m.setPosition(e[12], e[13] + 0.035, e[14]);
      mesh.setMatrixAt(n++, m);
    }
    mesh.count = n;
    if (n) mesh.instanceMatrix.needsUpdate = true;
  }
  return { update, mesh };
}
