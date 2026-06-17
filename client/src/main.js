import './ui/styles.css';
import * as THREE from 'three';
import { state, apiFetch } from './state.js';
import * as net from './net.js';
import { buildCity } from './world/city.js';
import { buildRealCity } from './world/cityReal.js';
import { ColliderGrid } from './world/grid.js';
import { buildArcade } from './world/arcade.js';
import { buildRange } from './world/range.js';
import { createControls, IS_TOUCH } from './player/controls.js';
import { createWeapon } from './player/weapon.js';
import { createRemotePlayers } from './player/remotes.js';
import { createTouchControls } from './ui/touch.js';
import { SPAWN } from './world/layout.js';
import { createNpcs } from './world/npcs.js';
import { buildSky } from './world/sky.js';
import { audio } from './audio.js';
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
  // Ombres dynamiques sur desktop ; désactivées sur mobile pour la fluidité
  const SHADOWS = !IS_TOUCH;

  const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: 'high-performance' });
  // Sur mobile on plafonne la résolution interne : moins de pixels à calculer
  const maxRatio = IS_TOUCH ? 1.5 : 2;
  function viewSize() {
    const vv = window.visualViewport;
    return {
      w: Math.round(vv?.width ?? window.innerWidth),
      h: Math.round(vv?.height ?? window.innerHeight),
    };
  }
  const v0 = viewSize();
  renderer.setSize(v0.w, v0.h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  if (SHADOWS) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  document.querySelector('#app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const skyColor = 0xbcd2ea; // couleur de l'horizon (raccord avec le dôme)
  scene.background = new THREE.Color(skyColor);
  scene.fog = new THREE.Fog(skyColor, 180, 560);

  const camera = new THREE.PerspectiveCamera(
    IS_TOUCH ? 82 : 75, v0.w / v0.h, 0.1, 1000
  );
  scene.add(camera); // nécessaire pour l'arme en vue subjective

  // Lumières : grand soleil sur Lyon (plus de contraste quand il y a des ombres)
  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x5a4c3c, SHADOWS ? 0.8 : 1.1));
  const sun = new THREE.DirectionalLight(0xfff3d6, SHADOWS ? 1.85 : 1.6);
  const SUN_OFFSET = new THREE.Vector3(-90, 130, 50);
  sun.position.copy(SUN_OFFSET);
  scene.add(sun);
  scene.add(sun.target);
  if (SHADOWS) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 95;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 420;
    sun.shadow.bias = -0.0006;
  }

  // Soleil visible dans le ciel (même direction que la lumière)
  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(24, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false })
  );
  sunMesh.position.set(-360, 520, 200);
  scene.add(sunMesh);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeHaloTexture(),
    transparent: true,
    depthWrite: false,
    fog: false,
  }));
  halo.scale.set(220, 220, 1);
  halo.position.copy(sunMesh.position);
  scene.add(halo);

  // --- Construction du monde ---
  const ctx = {
    scene,
    colliders: new ColliderGrid(),
    taggables: [],
    interactables: [],
    shootables: [],
    updatables: [], // animations du monde (eau, péniches, grande roue…)
    worldBound: null,
    waterBands: null,
  };

  // Vrai Lyon (données OpenStreetMap) si le fichier a été généré sur le
  // serveur avec tools/fetch-osm.mjs, sinon ville procédurale.
  let osmData = null;
  try {
    const res = await fetch('/lyon-osm.json');
    if (res.ok) osmData = await res.json();
  } catch { /* pas de données : ville procédurale */ }

  if (osmData?.buildings?.length > 50) {
    buildRealCity(ctx, osmData);
    camera.far = Math.max(1400, ctx.worldBound * 3);
    camera.updateProjectionMatrix();
    // Brouillard atmosphérique léger, repoussé loin pour garder la skyline
    scene.fog = new THREE.FogExp2(skyColor, 0.0011);
    ui.toast('Vrai centre de Lyon chargé — données © OpenStreetMap');
  } else {
    buildCity(ctx);
  }

  const sky = buildSky(scene, ctx.worldBound ? ctx.worldBound * 1.7 : 470);
  ctx.updatables.push((dt) => sky.update(dt));

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
    onShot: (a, b) => net.send({ t: 'shot', a, b }),
    getGroundY: () => controls.position.y,
  });
  const remotes = createRemotePlayers(scene, ctx.shootables, {
    onHitRemote: (id) => {
      audio.hitmarker();
      net.send({ t: 'hit', target: id });
    },
  });
  const spray = createSpray(scene, camera, ctx.taggables, {
    onToast: ui.toast,
    onModeChange: (on, paintColor) => {
      if (on && state.weaponEquipped) weapon.toggle(false);
      ui.setTagMode(on ? paintColor : null);
    },
  });
  spray.loadExisting(state.tags);
  const tagEditor = createTagEditor({ onToast: ui.toast });
  const npcs = createNpcs(ctx, { getPlayerPos: () => controls.position });

  // Active les ombres sur tout le monde statique déjà construit
  if (SHADOWS) {
    scene.traverse((o) => {
      if (o.isMesh && !o.userData.noShadow) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  // Peinture à main levée : clic maintenu en mode bombe
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 && state.tagMode) spray.setPaint(true);
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) spray.setPaint(false);
  });
  window.addEventListener('wheel', (e) => {
    if (state.tagMode && !state.overlayOpen) {
      spray.cycleColor(e.deltaY > 0 ? 1 : -1);
    }
  });

  // --- PvP ---
  let myNetId = null;
  net.on('hello', (msg) => { myNetId = msg.id; ui.setHp(100); });
  net.on('shot', (msg) => {
    weapon.fx.spawnTracer(msg.a, msg.b);
    weapon.fx.spawnImpact(msg.b);
  });
  net.on('hp', (msg) => {
    if (msg.id === myNetId) {
      ui.setHp(msg.hp);
      ui.damageFlash();
    }
  });
  // Série de kills → annonce vocale + bannière
  let killTimes = [];
  const STREAK_LABELS = ['K.O. !', 'DOUBLE KILL !', 'TRIPLE KILL !', 'QUADRA KILL !', 'MONSTER KILL !!'];
  const STREAK_VOICE = ['K.O.', 'Double kill', 'Triple kill', 'Quadra kill', 'Monster kill'];

  net.on('death', (msg) => {
    if (msg.id === myNetId) {
      controls.teleport(SPAWN.x, SPAWN.y, SPAWN.z);
      ui.setHp(100);
      ui.damageFlash(true);
      ui.toast(`💀 Tu as été abattu par ${msg.byName} ! Retour à Bellecour.`);
    } else if (msg.by === myNetId) {
      const now = Date.now();
      killTimes = killTimes.filter((t) => now - t < 9000);
      killTimes.push(now);
      const idx = Math.min(killTimes.length, STREAK_LABELS.length) - 1;
      ui.killBanner(STREAK_LABELS[idx]);
      audio.announce(STREAK_VOICE[idx]);
      ui.toast(`🎯 Tu as abattu ${msg.victimName} ! (${msg.kills} kill${msg.kills > 1 ? 's' : ''} cette session)`);
    } else {
      ui.toast(`☠ ${msg.byName} a abattu ${msg.victimName}`);
    }
  });

  // --- Chat de proximité ---
  ui.onChatSend((text) => net.send({ t: 'chat', text }));
  net.on('chat', (msg) => ui.addChatLine(msg.name, msg.text));

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

    // Entrée : ouvrir le chat de proximité
    if (e.code === 'Enter') { ui.openChat(); return; }
    if (e.code === 'KeyE' && nearestInteractable) nearestInteractable.action();
    if (e.code === 'KeyF') spray.toggleMode();
    if (e.code === 'KeyG') spray.stampTag();
    if (e.code === 'KeyT') tagEditor.open();
    if (e.code === 'KeyL') ui.toggleLeaderboards();
    if (e.code === 'KeyP') ui.toggleAdmin();
    if (e.code === 'KeyX' && state.isAdmin) {
      spray.deleteAimedTag().then((res) => {
        ui.toast(res.ok ? '🗑 Tag supprimé.' : res.error);
      });
    }
  });

  // --- Contrôles tactiles (mobile) ---
  if (IS_TOUCH) {
    createTouchControls({
      controls, weapon, spray, tagEditor, ui,
      interact: () => nearestInteractable?.action(),
    });

    // Bloque le zoom pincé, le double-tap zoom et le geste Safari
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('gesturechange', (e) => e.preventDefault());
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1) e.preventDefault(); // pincement
    }, { passive: false });
    let lastTap = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTap < 300) e.preventDefault(); // double-tap
      lastTap = now;
    }, { passive: false });

    // Plein écran au premier appui (et sur le bouton dédié)
    const goFullscreen = () => {
      const el = document.documentElement;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen;
      if (fn && !document.fullscreenElement) fn.call(el).catch(() => {});
      if (screen.orientation?.lock) screen.orientation.lock('landscape').catch(() => {});
    };
    window.addEventListener('touchend', goFullscreen, { once: true });
  }

  function onResize() {
    const { w, h } = viewSize();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
  window.visualViewport?.addEventListener('resize', onResize);

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

  let stepTimer = 0;

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);

    controls.update(dt);
    weapon.update(dt, controls.isMoving());
    spray.update(dt);
    remotes.update();
    range.update(dt);
    npcs.update(dt);
    for (const u of ctx.updatables) u(dt);

    // L'arme range la bombe (et inversement)
    if (state.weaponEquipped && state.tagMode) spray.setMode(false);

    // Bruits de pas : cadence et volume selon la vitesse réelle
    const speed = controls.speed();
    if (controls.onGround && speed > 1.2) {
      stepTimer -= dt;
      if (stepTimer <= 0) {
        audio.footstep(Math.min(1, speed / 10));
        stepTimer = Math.max(0.27, Math.min(0.7, 3.3 / speed));
      }
    } else {
      stepTimer = Math.min(stepTimer, 0.12);
    }

    // L'ombre suit le joueur (zone de 190 m autour de lui)
    if (SHADOWS) {
      sun.position.copy(controls.position).add(SUN_OFFSET);
      sun.target.position.copy(controls.position);
    }

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

// Halo lumineux autour du soleil (dégradé radial)
function makeHaloTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255, 248, 220, 0.9)');
  grad.addColorStop(0.25, 'rgba(255, 240, 190, 0.45)');
  grad.addColorStop(0.6, 'rgba(255, 235, 170, 0.12)');
  grad.addColorStop(1, 'rgba(255, 235, 170, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}
