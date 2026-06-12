import * as THREE from 'three';
import { state, apiFetch } from '../state.js';
import * as net from '../net.js';

const SPRAY_RANGE = 7;
const TAG_SIZE = 2.0;

export function createSpray(scene, camera, taggables, { onToast }) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = SPRAY_RANGE;
  const loader = new THREE.TextureLoader();
  const decals = new Map(); // tagId -> mesh
  let spraying = false;

  function addDecal(tag) {
    if (decals.has(tag.id)) return;
    const tex = loader.load(tag.image);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(tag.size, tag.size),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        depthWrite: false,
      })
    );
    mesh.position.set(tag.px, tag.py, tag.pz);
    mesh.quaternion.set(tag.qx, tag.qy, tag.qz, tag.qw);
    scene.add(mesh);
    decals.set(tag.id, mesh);
  }

  function loadExisting(tags) {
    for (const tag of tags) addDecal(tag);
  }

  net.on('tag', (msg) => addDecal(msg.tag));

  async function trySpray() {
    if (spraying) return;
    if (!state.activeTagImage) {
      onToast('Aucun tag sélectionné — appuie sur T pour en créer un.');
      return;
    }
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(taggables, false);
    if (hits.length === 0) {
      onToast('Vise un mur à moins de 7 m pour taguer.');
      return;
    }
    const hit = hits[0];
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    // Position légèrement décollée du mur (offset aléatoire anti z-fight entre tags)
    const pos = hit.point.clone().addScaledVector(normal, 0.03 + Math.random() * 0.02);

    // Orientation : le plan du tag plaqué sur le mur, le haut vers le ciel
    const up = Math.abs(normal.y) > 0.99
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4().lookAt(normal, new THREE.Vector3(0, 0, 0), up);
    const quat = new THREE.Quaternion().setFromRotationMatrix(m);

    spraying = true;
    try {
      await apiFetch('/tags', {
        method: 'POST',
        body: JSON.stringify({
          image: state.activeTagImage,
          p: [pos.x, pos.y, pos.z],
          quat: [quat.x, quat.y, quat.z, quat.w],
          size: TAG_SIZE,
        }),
      });
      // Le décal sera ajouté à la réception du broadcast WebSocket.
    } catch (err) {
      onToast('Tag refusé : ' + err.message);
    } finally {
      setTimeout(() => { spraying = false; }, 400); // anti-spam
    }
  }

  return { trySpray, loadExisting };
}
