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
import { createVoice } from './player/voice.js';
import { createTouchControls } from './ui/touch.js';
import { SPAWN } from './world/layout.js';
import { createNpcs } from './world/npcs.js';
import { buildSky } from './world/sky.js';
import { audio } from './audio.js';
import { createSpray } from './tags/spray.js';
import { createTagEditor } from './tags/editor.js';
import { createGameShell } from './games/shell.js';
import { createUi } from './ui/hud.js';
import { createProgress } from './progress.js';
import { createCapture } from './capture.js';

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
  renderer.toneMappingExposure = 1.12;
  if (SHADOWS) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  document.querySelector('#app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const skyColor = 0xdce6ee; // couleur de l'horizon (raccord avec le dôme)
  scene.background = new THREE.Color(skyColor);
  // Brume de distance : commence plus près pour la perspective atmosphérique
  scene.fog = new THREE.Fog(skyColor, 130, 540);

  // --- Cycle jour/nuit ---------------------------------------------------
  // Basé sur l'horloge (Date.now()) : tous les joueurs voient la même heure
  // sans aucune synchro serveur. Cycle de 10 min (~6,5 min jour, 3,5 min nuit).
  const DAY_CYCLE_MS = 10 * 60 * 1000;
  const ENV_DAY = {
    top: new THREE.Color(0x2e63b8), mid: new THREE.Color(0x7fa8dd),
    horizon: new THREE.Color(0xdce6ee), fog: new THREE.Color(0xdce6ee),
    hemiSky: new THREE.Color(0xaac8f0), hemiGround: new THREE.Color(0x6e604c),
    sun: new THREE.Color(0xffe7bd),
  };
  const ENV_NIGHT = {
    top: new THREE.Color(0x081020), mid: new THREE.Color(0x121d3a),
    horizon: new THREE.Color(0x232c46), fog: new THREE.Color(0x1a2236),
    hemiSky: new THREE.Color(0x4a5a85), hemiGround: new THREE.Color(0x2a2d3c),
    sun: new THREE.Color(0xa8bce8),
  };
  const DUSK_TINT = new THREE.Color(0xff8a4d);
  // phase 0..1 → position du soleil ; jour étiré (65 % du cycle)
  function envPhase() {
    const raw = (Date.now() % DAY_CYCLE_MS) / DAY_CYCLE_MS;
    return raw < 0.65 ? (raw / 0.65) * 0.5 : 0.5 + ((raw - 0.65) / 0.35) * 0.5;
  }
  const env = { daylight: 1, night: 0, dusk: 0, sunDir: new THREE.Vector3(0, 1, 0) };

  const camera = new THREE.PerspectiveCamera(
    IS_TOUCH ? 82 : 75, v0.w / v0.h, 0.1, 1000
  );
  scene.add(camera); // nécessaire pour l'arme en vue subjective

  // Lumières : soleil directionnel + rebond hémisphérique, tous deux pilotés
  // par le cycle jour/nuit (plus de contraste quand il y a des ombres)
  const hemi = new THREE.HemisphereLight(0xaac8f0, 0x6e604c, SHADOWS ? 0.75 : 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe7bd, SHADOWS ? 2.0 : 1.7);
  const SUN_OFFSET = new THREE.Vector3(-90, 130, 50);
  sun.position.copy(SUN_OFFSET);
  scene.add(sun);
  scene.add(sun.target);
  const HEMI_MAX = SHADOWS ? 0.75 : 1.05;
  const SUN_MAX = SHADOWS ? 2.0 : 1.7;
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

  // Soleil et lune visibles dans le ciel (même direction que la lumière)
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
  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(16, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xdfe6f5, fog: false })
  );
  moonMesh.visible = false;
  scene.add(moonMesh);

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
    env, // cycle jour/nuit lisible par le décor (halos de lampadaires…)
    notify: (msg) => ui.toast(msg), // événements du monde (silure, statue…)
    onRoi: null, // branché plus bas, une fois les PNJ créés
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
  ctx.updatables.push((dt) => sky.update(dt, env.daylight));

  // Interpolation de toute l'ambiance (ciel, brume, lumières, soleil/lune)
  // selon la phase du cycle. Appelée à chaque frame : uniquement des lerps.
  const _envColor = new THREE.Color();
  const _lightDir = new THREE.Vector3(0, 1, 0);
  function updateEnvironment() {
    const ang = envPhase() * Math.PI * 2; // 0 = aube, π/2 = midi
    const elev = Math.sin(ang);
    const daylight = THREE.MathUtils.clamp(elev * 2.4, 0, 1);
    const dusk = Math.max(0, 1 - Math.abs(elev) * 4); // pic aube/crépuscule
    env.daylight = daylight;
    env.night = 1 - daylight;
    env.dusk = dusk;
    env.sunDir.set(-Math.cos(ang) * 0.9, elev, 0.42).normalize();

    // Ciel
    const u = sky.uniforms;
    u.topColor.value.copy(ENV_NIGHT.top).lerp(ENV_DAY.top, daylight);
    u.midColor.value.copy(ENV_NIGHT.mid).lerp(ENV_DAY.mid, daylight);
    u.horizonColor.value.copy(ENV_NIGHT.horizon).lerp(ENV_DAY.horizon, daylight)
      .lerp(DUSK_TINT, dusk * 0.35);
    u.sunTint.value.set(0xffe0b0).lerp(DUSK_TINT, dusk * 0.8);
    u.sunDir.value.copy(env.sunDir);
    u.starAmount.value = THREE.MathUtils.clamp(env.night * 1.3 - 0.3, 0, 1);

    // Brume + fond raccordés à l'horizon
    _envColor.copy(ENV_NIGHT.fog).lerp(ENV_DAY.fog, daylight).lerp(DUSK_TINT, dusk * 0.18);
    scene.fog.color.copy(_envColor);
    scene.background.copy(_envColor);

    // Lumières
    hemi.color.copy(ENV_NIGHT.hemiSky).lerp(ENV_DAY.hemiSky, daylight);
    hemi.groundColor.copy(ENV_NIGHT.hemiGround).lerp(ENV_DAY.hemiGround, daylight);
    hemi.intensity = HEMI_MAX * (0.45 + 0.55 * daylight);
    sun.intensity = SUN_MAX * daylight + 0.3 * env.night; // clair de lune la nuit
    sun.color.copy(ENV_DAY.sun).lerp(DUSK_TINT, dusk * 0.7)
      .lerp(ENV_NIGHT.sun, env.night);
    if (SHADOWS) sun.castShadow = daylight > 0.04;

    // La lumière vient du soleil le jour, de la lune la nuit
    if (elev >= 0.02) _lightDir.copy(env.sunDir);
    else _lightDir.set(0.5, 0.8, -0.3).normalize();
    env.lightDir = _lightDir;

    // Astres visibles
    const p = controls?.position ?? SPAWN;
    sunMesh.position.set(p.x, 0, p.z).addScaledVector(env.sunDir, 620);
    sunMesh.visible = elev > -0.12;
    halo.position.copy(sunMesh.position);
    halo.material.opacity = Math.max(0, Math.min(1, elev * 3 + 0.25));
    halo.visible = sunMesh.visible;
    moonMesh.position.set(p.x, 0, p.z)
      .addScaledVector(env.sunDir, -620);
    moonMesh.visible = elev < 0.1;
  }

  // --- Progression : XP, niveaux, succès ---
  const progress = createProgress({
    onXp: (xp, opts) => ui.setXp(xp, opts),
    onUnlock: (a) => ui.achievementUnlocked(a),
  });
  ui.bindProgress(progress);
  progress.refresh(); // restaure la barre d'XP et les succès déjà gagnés

  const shell = createGameShell({
    onToast: ui.toast,
    onXp: (xp, xpGain) => {
      ui.setXp(xp);
      audio.reward();
      if (xpGain) ui.toast(`+${xpGain} XP`);
      progress.refresh();
    },
  });
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
        const res = await apiFetch('/scores', {
          method: 'POST',
          body: JSON.stringify({ gameId: 'shooting-range', score, accuracy }),
        });
        if (res.xp != null) {
          ui.setXp(res.xp);
          audio.reward();
        }
        progress.refresh();
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
      ui.hitmarker();
      navigator.vibrate?.(18);
      net.send({ t: 'hit', target: id });
    },
  });
  const spray = createSpray(scene, camera, ctx.taggables, {
    onToast: ui.toast,
    onModeChange: (on, paintColor) => {
      if (on && state.weaponEquipped) weapon.toggle(false);
      ui.setTagMode(on ? paintColor : null);
    },
    onSaved: (res) => {
      if (res.xp != null) {
        ui.setXp(res.xp);
        audio.reward();
      }
      progress.refresh();
    },
  });
  spray.loadExisting(state.tags);
  const tagEditor = createTagEditor({ onToast: ui.toast });
  const npcs = createNpcs(ctx, {
    getPlayerPos: () => controls.position,
    onNpcHit: () => {
      audio.hitmarker();
      ui.hitmarker();
      navigator.vibrate?.(14);
    },
  });

  // Easter egg de la statue : voix royale + clameur des PNJ + confettis
  ctx.onRoi = () => {
    audio.announce('Vive le Roi !');
    npcs.shout('VIVE LE ROI !');
    ui.spawnConfetti(30);
  };

  // Capture d'écran stylée : touche C (desktop) ou bouton 📸 (tactile)
  const capture = createCapture({ renderer, scene, camera, onToast: ui.toast });

  // --- Emotes ridicules (3/4/5 ou bouton 😜) : passent par le chat de
  // proximité, donc visibles en bulle au-dessus de la tête pour les autres
  const EMOTES = [
    { text: '👋 Salut les gones !', voice: 'Salut les gones !' },
    { text: '💃 Danse de la quenelle !', voice: 'Danse de la quenelle !' },
    { text: '👑 VIVE LE ROI !', voice: 'Vive le roi !' },
  ];
  let lastEmoteAt = 0;
  function emote(idx) {
    const now = Date.now();
    if (now - lastEmoteAt < 600) return; // même anti-spam que le serveur
    lastEmoteAt = now;
    const e = EMOTES[idx % EMOTES.length];
    net.send({ t: 'chat', text: e.text });
    ui.addChatLine(state.auth?.name ?? 'moi', e.text, true);
    audio.speak(e.voice, { pitch: 1.4 + Math.random() * 0.4, rate: 1.15, volume: 0.9 });
    navigator.vibrate?.(10);
  }

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
      if (!msg.regen) {
        ui.damageFlash();
        navigator.vibrate?.(45);
      }
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
      ui.deathScreen(msg.byName);
      navigator.vibrate?.([80, 40, 120]);
    } else if (msg.by === myNetId) {
      const now = Date.now();
      killTimes = killTimes.filter((t) => now - t < 9000);
      killTimes.push(now);
      const idx = Math.min(killTimes.length, STREAK_LABELS.length) - 1;
      ui.killBanner(STREAK_LABELS[idx]);
      audio.announce(STREAK_VOICE[idx]);
      ui.toast(`🎯 Tu as abattu ${msg.victimName} ! +50 XP (${msg.kills} kill${msg.kills > 1 ? 's' : ''} cette session)`);
      progress.refresh();
    } else {
      ui.toast(`☠ ${msg.byName} a abattu ${msg.victimName}`);
    }
  });

  // --- Chat de proximité ---
  ui.onChatSend((text) => net.send({ t: 'chat', text }));
  net.on('chat', (msg) => ui.addChatLine(msg.name, msg.text));

  // --- Chat vocal de proximité (WebRTC) ---
  const voice = createVoice({
    getMyId: () => myNetId,
    getMyPos: () => controls.position,
    getRemotePos: (id) => remotes.getPos(id),
    onToast: ui.toast,
    onState: (on) => ui.setMicState?.(on),
  });

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
    if (e.code === 'KeyC') capture.take();
    if (e.code === 'Digit3') emote(0);
    if (e.code === 'Digit4') emote(1);
    if (e.code === 'Digit5') emote(2);
    if (e.code === 'KeyF') spray.toggleMode();
    if (e.code === 'KeyG') spray.stampTag();
    if (e.code === 'KeyT') tagEditor.open();
    if (e.code === 'KeyL') ui.toggleLeaderboards();
    if (e.code === 'KeyP') ui.toggleAdmin();
    if (e.code === 'KeyV') voice.toggleMic();
    if (e.code === 'KeyX' && state.isAdmin) {
      spray.deleteAimedTag().then((res) => {
        ui.toast(res.ok ? '🗑 Tag supprimé.' : res.error);
      });
    }
  });

  // --- Contrôles tactiles (mobile) ---
  if (IS_TOUCH) {
    createTouchControls({
      controls, weapon, spray, tagEditor, ui, voice, capture, emote,
      interact: () => nearestInteractable?.action(),
    });
    // Le prompt « ▶ JOUER » est lui-même tactile : plus besoin de viser le bouton E.
    ui.onPromptTap(() => nearestInteractable?.action());

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
    voice.update();
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

    // Ambiance jour/nuit + lumière qui suit le joueur (zone d'ombres de 190 m)
    updateEnvironment();
    sun.position.copy(controls.position).addScaledVector(env.lightDir, 165);
    sun.target.position.copy(controls.position);

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
