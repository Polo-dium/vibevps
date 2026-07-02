import * as THREE from 'three';
import { state, apiFetch } from '../state.js';
import * as net from '../net.js';
import { audio } from '../audio.js';
import { IS_TOUCH } from '../player/controls.js';

const SPRAY_RANGE = 7;
const STAMP_SIZE = 2.0; // taille des tags « image » posés
const PAINT_SIZE = 3.2; // côté (m) de la zone de graffiti à main levée
const CANVAS_PX = 384;
const BRUSH_PX = 26;

export const PAINT_COLORS = [
  '#ff3df0', '#00ffd5', '#ffe14d', '#ff5252',
  '#4da6ff', '#4dff6a', '#ff9d3d', '#ffffff', '#111111',
];
// Niveau requis pour chaque couleur : 4 offertes, les autres se méritent
export const COLOR_MIN_LEVEL = [1, 1, 1, 1, 2, 3, 4, 5, 6];

export function createSpray(scene, camera, taggables, { onToast, onModeChange, onSaved }) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = SPRAY_RANGE;
  const loader = new THREE.TextureLoader();
  const decals = new Map(); // tagId -> mesh
  let stamping = false;
  let colorIdx = 0;
  let painting = false; // bouton de peinture maintenu
  let session = null; // graffiti en cours sur un mur
  let saving = false;

  // --- Bombe de peinture en vue subjective ---
  const can = buildSprayCan();
  can.visible = false;
  camera.add(can);
  let canTime = 0;

  // --- Gouttelettes de peinture (géométrie et matériaux partagés) ---
  const MAX_DROPS = 40;
  const dropGeo = new THREE.SphereGeometry(0.025, 5, 4);
  const dropMats = new Map(); // couleur -> matériau partagé
  const drops = []; // { mesh, vel, life }
  function dropMat(col) {
    let m = dropMats.get(col);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: col });
      dropMats.set(col, m);
    }
    return m;
  }
  function spawnSplatter(point, normal, count) {
    for (let i = 0; i < count; i++) {
      if (drops.length >= MAX_DROPS) {
        const old = drops.shift();
        scene.remove(old.mesh);
      }
      const mesh = new THREE.Mesh(dropGeo, dropMat(color()));
      mesh.position.copy(point);
      mesh.scale.setScalar(0.7 + Math.random() * 0.9);
      scene.add(mesh);
      const vel = normal.clone().multiplyScalar(0.8 + Math.random() * 1.4);
      vel.x += (Math.random() - 0.5) * 1.6;
      vel.y += Math.random() * 0.9;
      vel.z += (Math.random() - 0.5) * 1.6;
      drops.push({ mesh, vel, life: 0.3 + Math.random() * 0.25 });
    }
  }
  function updateDrops(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.life -= dt;
      d.vel.y -= 7 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 2.2));
      if (d.life <= 0) {
        scene.remove(d.mesh);
        drops.splice(i, 1);
      }
    }
  }

  function color() { return PAINT_COLORS[colorIdx]; }

  function applyCanColor() {
    can.userData.bodyMat.color.set(color());
  }
  applyCanColor();

  // --- Décals réseau ---
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
  net.on('tagDel', (msg) => {
    const mesh = decals.get(msg.id);
    if (mesh) {
      scene.remove(mesh);
      decals.delete(msg.id);
    }
  });
  net.on('tagsClear', () => {
    for (const mesh of decals.values()) scene.remove(mesh);
    decals.clear();
  });

  // Admin : supprimer le tag visé (raycast sur les décals)
  async function deleteAimedTag() {
    raycaster.far = 18;
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const meshes = [...decals.values()];
    const hits = raycaster.intersectObjects(meshes, false);
    raycaster.far = SPRAY_RANGE;
    if (hits.length === 0) return { ok: false, error: 'Aucun tag visé (vise un graffiti à moins de 18 m).' };
    let tagId = null;
    for (const [id, mesh] of decals) {
      if (mesh === hits[0].object) { tagId = id; break; }
    }
    if (!tagId) return { ok: false, error: 'Tag introuvable.' };
    try {
      await apiFetch(`/tags/${tagId}`, { method: 'DELETE' });
      return { ok: true }; // le décal disparaît via le broadcast tagDel
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // --- Mode bombe ---
  function setMode(on) {
    if (state.tagMode === on) return;
    state.tagMode = on;
    can.visible = on;
    if (!on) {
      setPaint(false);
      finishSession();
    }
    onModeChange?.(on, color());
  }
  function toggleMode() { setMode(!state.tagMode); }

  function cycleColor(dir = 1) {
    // Saute les couleurs pas encore débloquées (niveau du joueur)
    for (let i = 0; i < PAINT_COLORS.length; i++) {
      colorIdx = (colorIdx + dir + PAINT_COLORS.length) % PAINT_COLORS.length;
      if (COLOR_MIN_LEVEL[colorIdx] <= (state.level ?? 1)) break;
    }
    applyCanColor();
    onModeChange?.(state.tagMode, color());
  }

  function setPaint(down) {
    painting = down;
    if (!down) {
      audio.hissStop();
      if (session) session.lastUv = null;
    }
  }

  // --- Graffiti à main levée ---
  function wallOrientation(normal) {
    const up = Math.abs(normal.y) > 0.99
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4().lookAt(normal, new THREE.Vector3(0, 0, 0), up);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  function startSession(hit, normal) {
    const quat = wallOrientation(normal);
    const center = hit.point.clone().addScaledVector(normal, 0.035 + Math.random() * 0.015);
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_PX;
    canvas.height = CANVAS_PX;
    const g = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PAINT_SIZE, PAINT_SIZE),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        depthWrite: false,
      })
    );
    mesh.position.copy(center);
    mesh.quaternion.copy(quat);
    scene.add(mesh);

    session = {
      mesh, canvas, g, tex, center, quat,
      normal: normal.clone(),
      right: new THREE.Vector3(1, 0, 0).applyQuaternion(quat),
      upv: new THREE.Vector3(0, 1, 0).applyQuaternion(quat),
      lastUv: null,
      hasContent: false,
    };
  }

  function pointToUv(point) {
    const d = point.clone().sub(session.center);
    const dx = d.dot(session.right);
    const dy = d.dot(session.upv);
    return {
      x: (dx / (PAINT_SIZE / 2) * 0.5 + 0.5) * CANVAS_PX,
      y: (0.5 - dy / (PAINT_SIZE / 2) * 0.5) * CANVAS_PX,
      dx, dy,
    };
  }

  function paintFrame() {
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(taggables, false);
    if (hits.length === 0) {
      audio.hissStop();
      if (session) session.lastUv = null;
      return;
    }
    const hit = hits[0];
    const normal = hit.face.normal.clone()
      .transformDirection(hit.object.matrixWorld).normalize();

    // Nouveau mur ou sortie de la zone : on sauvegarde et on repart
    if (session) {
      const planeDist = hit.point.clone().sub(session.center).dot(session.normal);
      const uv = pointToUv(hit.point);
      const out = Math.abs(uv.dx) > PAINT_SIZE / 2 - 0.05 || Math.abs(uv.dy) > PAINT_SIZE / 2 - 0.05;
      if (normal.dot(session.normal) < 0.9 || Math.abs(planeDist) > 0.35 || out) {
        finishSession();
      }
    }
    if (!session) startSession(hit, normal);

    const uv = pointToUv(hit.point);
    const g = session.g;
    g.strokeStyle = color();
    g.fillStyle = color();
    g.lineWidth = BRUSH_PX;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.shadowColor = color();
    g.shadowBlur = 10;
    g.globalAlpha = 0.92;
    if (session.lastUv) {
      g.beginPath();
      g.moveTo(session.lastUv.x, session.lastUv.y);
      g.lineTo(uv.x, uv.y);
      g.stroke();
    } else {
      g.beginPath();
      g.arc(uv.x, uv.y, BRUSH_PX / 2, 0, Math.PI * 2);
      g.fill();
    }
    session.lastUv = uv;
    session.hasContent = true;

    // Coulure de peinture occasionnelle (le charme du vrai graff)
    if (Math.random() < 0.05) {
      const len = 12 + Math.random() * 34;
      g.shadowBlur = 3;
      g.globalAlpha = 0.55;
      g.lineWidth = 2.5 + Math.random() * 2;
      g.beginPath();
      g.moveTo(uv.x + (Math.random() - 0.5) * 8, uv.y);
      g.lineTo(uv.x + (Math.random() - 0.5) * 4, uv.y + len);
      g.stroke();
    }
    session.tex.needsUpdate = true;

    // Gouttelettes qui giclent du mur
    if (Math.random() < 0.4) spawnSplatter(hit.point, normal, 1);
    audio.hissStart();
  }

  async function finishSession() {
    if (!session) return;
    const s = session;
    session = null;
    if (!s.hasContent) {
      scene.remove(s.mesh);
      return;
    }
    // Export compact (256 px) pour le serveur
    const out = document.createElement('canvas');
    out.width = 256;
    out.height = 256;
    out.getContext('2d').drawImage(s.canvas, 0, 0, 256, 256);
    const image = out.toDataURL('image/png');

    saving = true;
    try {
      const res = await apiFetch('/tags', {
        method: 'POST',
        body: JSON.stringify({
          image,
          p: [s.center.x, s.center.y, s.center.z],
          quat: [s.quat.x, s.quat.y, s.quat.z, s.quat.w],
          size: PAINT_SIZE,
        }),
      });
      // On garde notre mesh local et on l'enregistre sous l'id serveur
      // pour ignorer l'écho WebSocket.
      decals.set(res.tag.id, s.mesh);
      onSaved?.(res);
    } catch (err) {
      onToast('Graffiti non sauvegardé : ' + err.message);
      // On le garde quand même localement.
    } finally {
      saving = false;
    }
  }

  // --- Pose du tag « image » de la bibliothèque (ancien comportement) ---
  async function stampTag() {
    if (stamping) return;
    if (!state.activeTagImage) {
      onToast('Aucun tag équipé — appuie sur T pour en créer un.');
      return;
    }
    raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const hits = raycaster.intersectObjects(taggables, false);
    if (hits.length === 0) {
      onToast('Vise un mur à moins de 7 m.');
      return;
    }
    const hit = hits[0];
    const normal = hit.face.normal.clone()
      .transformDirection(hit.object.matrixWorld).normalize();
    const pos = hit.point.clone().addScaledVector(normal, 0.03 + Math.random() * 0.02);
    const quat = wallOrientation(normal);

    stamping = true;
    audio.hissStart();
    setTimeout(() => audio.hissStop(), 350);
    spawnSplatter(hit.point, normal, 9);
    try {
      const res = await apiFetch('/tags', {
        method: 'POST',
        body: JSON.stringify({
          image: state.activeTagImage,
          p: [pos.x, pos.y, pos.z],
          quat: [quat.x, quat.y, quat.z, quat.w],
          size: STAMP_SIZE,
        }),
      });
      // Le décal arrive par le broadcast WebSocket.
      onSaved?.(res);
    } catch (err) {
      onToast('Tag refusé : ' + err.message);
    } finally {
      setTimeout(() => { stamping = false; }, 400);
    }
  }

  function update(dt) {
    updateDrops(dt);
    const inputOk = IS_TOUCH || state.pointerLocked;
    if (state.tagMode && painting && inputOk && !state.overlayOpen) {
      paintFrame();
    } else if (!painting) {
      audio.hissStop();
    }
    // Animation de la bombe : balancement + secousse pendant le spray
    if (can.visible) {
      canTime += dt * (painting ? 26 : 4);
      const shake = painting ? 0.006 : 0.0015;
      can.position.set(
        0.24 + Math.sin(canTime) * shake,
        -0.22 + Math.abs(Math.cos(canTime * 0.7)) * shake,
        -0.4
      );
      can.rotation.z = painting ? Math.sin(canTime * 2) * 0.05 : 0;
    }
  }

  return {
    loadExisting, addDecal, deleteAimedTag,
    setMode, toggleMode, cycleColor, setPaint, stampTag, update,
    finishSession,
    get color() { return color(); },
    get isSaving() { return saving; },
    // compat tactile (ancien nom)
    trySpray: stampTag,
  };
}

// Bombe de peinture low-poly
function buildSprayCan() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xff3df0 });
  const metal = new THREE.MeshLambertMaterial({ color: 0xd7dade });
  const dark = new THREE.MeshLambertMaterial({ color: 0x22262e });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 12), bodyMat);
  group.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.02, 12), metal);
  top.position.y = 0.09;
  group.add(top);
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.015, 12), metal);
  bottom.position.y = -0.085;
  group.add(bottom);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.025, 8), dark);
  nozzle.position.y = 0.11;
  group.add(nozzle);

  group.userData.bodyMat = bodyMat;
  group.position.set(0.24, -0.22, -0.4);
  group.rotation.x = 0.15;
  return group;
}
