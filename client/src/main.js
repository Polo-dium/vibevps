import './ui/styles.css';
import * as THREE from 'three';
import { state, apiFetch } from './state.js';
import * as net from './net.js';
import { buildCity } from './world/city.js';
import { buildArcade } from './world/arcade.js';
import { buildRange } from './world/range.js';
import { createControls } from './player/controls.js';
import { createWeapon } from './player/weapon.js';
import { createRemotePlayers } from './player/remotes.js';
import { createSpray } from './tags/spray.js';
import { createTagEditor } from './tags/editor.js';
import { createGameShell } from './games/shell.js';
import { createUi } from './ui/hud.js';

async function boot() {
  const ui = createUi();
  await ui.ensureAuth();

  // État partagé du monde
  const worldState = await apiFetch('/state');
  state.games = worldState.games;
  state.leaderboards = worldState.leaderboards;
  state.tags = worldState.tags;

  // --- Scène Three.js ---
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.querySelector('#app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const skyColor = 0x2a3354;
  scene.background = new THREE.Color(skyColor);
  scene.fog = new THREE.Fog(skyColor, 110, 380);

  const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 600
  );
  scene.add(camera); // nécessaire pour l'arme en vue subjective

  // Lumières : fin de journée lyonnaise
  scene.add(new THREE.HemisphereLight(0x9db4ff, 0x4a3b2d, 0.85));
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.25);
  sun.position.set(-90, 130, 50);
  scene.add(sun);

  // --- Construction du monde ---
  const ctx = {
    scene,
    colliders: [],
    taggables: [],
    interactables: [],
    shootables: [],
  };

  buildCity(ctx);

  const shell = createGameShell({ onToast: ui.toast });
  const arcade = buildArcade(ctx, {
    onPlayGame: (game) => shell.open(game),
    onOpenCreator: () => ui.openCreator(),
  });
  arcade.syncMachines(state.games);

  const range = buildRange(ctx, {
    onEquipWeapon: () => weapon.toggle(true),
    onSessionEnd: async ({ score, hits, shots, accuracy }) => {
      ui.setRange(null);
      ui.toast(`Stand de tir terminé : ${score} pts · ${hits}/${shots} touches · précision ${accuracy}%`);
      try {
        await apiFetch('/scores', {
          method: 'POST',
          body: JSON.stringify({ gameId: 'shooting-range', score, accuracy }),
        });
      } catch (err) {
        ui.toast('Score non enregistré : ' + err.message);
      }
    },
  });

  // --- Joueur, arme, distants, tags ---
  const controls = createControls(camera, renderer.domElement, ctx.colliders);
  const weapon = createWeapon(camera, scene, ctx.shootables, {
    onAmmoChange: (ammo, reloading) => ui.setAmmo(ammo, reloading, state.weaponEquipped),
    onShot: null,
  });
  const remotes = createRemotePlayers(scene);
  const spray = createSpray(scene, camera, ctx.taggables, { onToast: ui.toast });
  spray.loadExisting(state.tags);
  const tagEditor = createTagEditor({ onToast: ui.toast });

  // --- Réseau ---
  net.connect(() => controls.netState());
  net.on('game', (msg) => {
    state.games.push(msg.game);
    state.leaderboards[msg.game.id] = [];
    arcade.syncMachines(state.games);
    ui.toast(`Nouvelle borne dans la salle : ${msg.game.title} (par ${msg.game.creator}) !`);
  });
  net.on('leaderboard', (msg) => {
    state.leaderboards[msg.gameId] = msg.rows;
  });
  net.on('error', (msg) => {
    // Token rejeté par le serveur (base réinitialisée ?) : on repart de zéro.
    localStorage.removeItem('vibevps_auth');
    ui.toast(msg.error + ' Recharge la page pour choisir un pseudo.');
  });

  // --- Touches d'action ---
  let nearestInteractable = null;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (shell.isOpen()) shell.close();
      else if (tagEditor.isOpen()) tagEditor.close();
      else ui.closeTopOverlay();
      return;
    }
    if (state.overlayOpen) return;

    if (e.code === 'KeyE' && nearestInteractable) nearestInteractable.action();
    if (e.code === 'KeyF') spray.trySpray();
    if (e.code === 'KeyT') tagEditor.open();
    if (e.code === 'KeyL') ui.toggleLeaderboards();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Boucle principale ---
  const clock = new THREE.Clock();
  let fpsAccum = 0, fpsFrames = 0, fpsValue = 60;
  let infoTimer = 0;

  function findNearestInteractable() {
    const p = controls.position;
    let best = null, bestDist = Infinity;
    for (const it of ctx.interactables) {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d < it.r && d < bestDist) {
        best = it;
        bestDist = d;
      }
    }
    return best;
  }

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);

    controls.update(dt);
    weapon.update(dt, controls.isMoving(), controls.isSprinting());
    remotes.update();
    range.update(dt);

    nearestInteractable = state.overlayOpen ? null : findNearestInteractable();
    ui.setPrompt(nearestInteractable?.label ?? null);
    ui.setRange(state.rangeSession);

    fpsAccum += dt;
    fpsFrames += 1;
    if (fpsAccum >= 0.5) {
      fpsValue = Math.round(fpsFrames / fpsAccum);
      fpsAccum = 0;
      fpsFrames = 0;
    }
    infoTimer -= dt;
    if (infoTimer <= 0) {
      infoTimer = 0.25;
      ui.setInfo({ fps: fpsValue, players: remotes.count(), pos: controls.position });
    }

    renderer.render(scene, camera);
  }
  loop();

  ui.toast('Bienvenue à Lyon ! La salle d’arcade est au nord de Bellecour.');
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    `<div style="color:#ff6b81; font-family:monospace; padding:40px;">
       Erreur au démarrage : ${err.message}<br>Le serveur est-il lancé ?
     </div>`;
});
