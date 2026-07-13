import './ui/styles.css';
import * as THREE from 'three';
import { state, apiFetch } from './state.js';
import * as net from './net.js';
import { buildCity } from './world/city.js';
import { buildRealCity } from './world/cityReal.js';
import { ColliderGrid } from './world/grid.js';
import { buildArcade } from './world/arcade.js';
import { buildRange } from './world/range.js';
import { buildLoot } from './world/loot.js';
import { buildRadioPickup } from './world/radioPickup.js';
import { buildWeaponQuest } from './world/weaponQuest.js';
import { buildBannerPlane, buildAirport } from './world/aviation.js';
import { createMusicSource, TRACKS } from './music.js';
import { createPoiMap } from './ui/map.js';
import { createControls, IS_TOUCH } from './player/controls.js';
import { createWeapon } from './player/weapon.js';
import { createArms } from './player/arms.js';
import { createRemotePlayers } from './player/remotes.js';
import { createVoice } from './player/voice.js';
import { createTouchControls } from './ui/touch.js';
import { ARCADE, spawnPoint } from './world/layout.js';
import { createNpcs } from './world/npcs.js';
import { createQuenelle } from './world/quenelle.js';
import { createRace } from './world/race.js';
import { buildSky } from './world/sky.js';
import { audio } from './audio.js';
import { createSpray } from './tags/spray.js';
import { createTagEditor } from './tags/editor.js';
import { createGameShell } from './games/shell.js';
import { createUi } from './ui/hud.js';
import { createProgress } from './progress.js';
import { createCapture } from './capture.js';
import { createQuality } from './quality.js';
import { createLoadingScreen, nextPaint } from './ui/loading.js';
import { createTutorial } from './ui/tutorial.js';

async function boot() {
  const loading = createLoadingScreen();
  // Les deux ressources les plus lourdes partent ensemble pendant que le
  // joueur choisit son pseudo. L'OSM reste optionnel et ne bloque jamais.
  const worldStatePromise = apiFetch('/state').then(
    (data) => {
      loading.set('Les gones sont synchronisés…', 38);
      return { data };
    },
    (error) => ({ error })
  );
  const osmPromise = fetch('/lyon-osm.json')
    .then((res) => res.ok ? res.json() : null)
    .then((data) => {
      loading.set(data ? 'La carte du Grand Lyon est arrivée…' : 'Plan B : Lyon procédural…', 62);
      return data;
    })
    .catch(() => null);

  const ui = createUi();
  await ui.ensureAuth();
  state.hasJetpack = state.inventory.includes('jetpack');
  state.hasRcPlane = state.inventory.includes('rc-plane');
  state.hasRadio = state.inventory.includes('radio');

  // Déblocages persistants liés au compte. L'ajout local est immédiat pour
  // ne jamais interrompre un ramassage si le réseau met quelques secondes.
  function rememberInventoryItem(id) {
    if (state.inventory.includes(id)) return false;
    state.inventory.push(id);
    apiFetch('/me/inventory', {
      method: 'POST', body: JSON.stringify({ id }),
    }).then((res) => {
      for (const saved of res.inventory ?? []) {
        if (!state.inventory.includes(saved)) state.inventory.push(saved);
      }
    }).catch(() => ui.toast('⚠️ Objet gardé pour cette partie, mais la sauvegarde du compte a échoué.'));
    return true;
  }

  // Lien d'invitation (?ami=Pseudo) : si l'ami est en ligne, le serveur nous
  // renvoie sa position dans le message 'hello' et on atterrit à côté de lui
  const inviteFriend = new URLSearchParams(location.search).get('ami');

  // État partagé du monde
  loading.set('Chargement de Bellecour…', 68);
  let worldState;
  try {
    const result = await worldStatePromise;
    if (result.error) throw result.error;
    worldState = result.data;
  } catch (err) {
    loading.fail(`Impossible de joindre Lyon : ${err.message}`);
    return;
  }
  state.games = worldState.games;
  state.leaderboards = worldState.leaderboards;
  state.tags = worldState.tags;

  // --- Scène Three.js ---
  // Qualité graphique : 3 paliers (bas/moyen/élevé), auto-détectés puis
  // ajustables à la volée (touche O) — voir quality.js. Les ombres restent
  // le plus gros poste de coût sur un GPU intégré, bien plus que le nombre
  // de triangles de la ville (identique à tous les paliers).
  const quality = createQuality(IS_TOUCH);
  const SHADOWS = quality.preset.shadows;

  const renderer = new THREE.WebGLRenderer({
    antialias: !IS_TOUCH && quality.level !== 'bas', powerPreference: 'high-performance',
  });
  function viewSize() {
    const vv = window.visualViewport;
    return {
      w: Math.round(vv?.width ?? window.innerWidth),
      h: Math.round(vv?.height ?? window.innerHeight),
    };
  }
  const v0 = viewSize();
  renderer.setSize(v0.w, v0.h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.preset.pixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = SHADOWS;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.querySelector('#app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const skyColor = 0xdce6ee; // couleur de l'horizon (raccord avec le dôme)
  scene.background = new THREE.Color(skyColor);
  // Brume de distance : commence plus près pour la perspective atmosphérique
  scene.fog = new THREE.Fog(skyColor, 130, 540);

  // --- Cycle jour/nuit ---------------------------------------------------
  // Basé sur l'horloge (Date.now()) : tous les joueurs voient la même heure
  // sans aucune synchro serveur. Cycle exact de 10 min : 8 min de jour,
  // puis 2 min de nuit, transitions comprises.
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
  const DAY_SHARE = 0.8;
  // phase 0..1 → position du soleil. La demi-orbite visible est parcourue
  // sur 80 % du temps, la demi-orbite sous l'horizon sur les 20 % restants.
  function envPhase() {
    const raw = (Date.now() % DAY_CYCLE_MS) / DAY_CYCLE_MS;
    return raw < DAY_SHARE
      ? (raw / DAY_SHARE) * 0.5
      : 0.5 + ((raw - DAY_SHARE) / (1 - DAY_SHARE)) * 0.5;
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
  // Toujours configurée (même si les ombres démarrent désactivées) pour que
  // la touche O puisse les rallumer plus tard sans réglage à moitié fait.
  sun.castShadow = SHADOWS;
  sun.shadow.mapSize.set(quality.preset.shadowMapSize, quality.preset.shadowMapSize);
  const SHADOW_D = 95;
  sun.shadow.camera.left = -SHADOW_D;
  sun.shadow.camera.right = SHADOW_D;
  sun.shadow.camera.top = SHADOW_D;
  sun.shadow.camera.bottom = -SHADOW_D;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0006;

  // Applique un changement de palier en direct : résolution interne, ombres
  // on/off, et régénération de la shadow map si sa résolution a changé.
  // shadowsEnabled (contrairement à SHADOWS, figée au démarrage) suit l'état
  // courant : c'est elle que lit la boucle jour/nuit plus bas.
  let shadowsEnabled = SHADOWS;
  quality.onChange((preset) => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
    renderer.shadowMap.enabled = preset.shadows;
    shadowsEnabled = preset.shadows;
    sun.castShadow = preset.shadows;
    if (preset.shadows && sun.shadow.mapSize.width !== preset.shadowMapSize) {
      sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  });

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
    new THREE.MeshBasicMaterial({ color: 0xf2f5ff, fog: false })
  );
  moonMesh.visible = false;
  scene.add(moonMesh);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeHaloTexture(), color: 0xbfd2ff,
    transparent: true, opacity: 0.42,
    depthWrite: false, fog: false,
  }));
  moonHalo.visible = false;
  scene.add(moonHalo);

  // --- Construction du monde ---
  const ctx = {
    scene,
    colliders: new ColliderGrid(),
    taggables: [],
    interactables: [],
    shootables: [],
    updatables: [], // animations du monde (eau, péniches, grande roue…)
    pois: [], // points d'intérêt (remplis par le décor, révélés sur la carte M)
    worldBound: null,
    waterBands: null,
    env, // cycle jour/nuit lisible par le décor (halos de lampadaires…)
    notify: (msg) => ui.toast(msg), // événements du monde (silure, statue…)
    onRoi: null, // branché plus bas, une fois les PNJ créés
    abortRides: [], // les manèges (Grande Roue, ficelle…) s'y inscrivent
    playerPos: () => controls.position, // lu par le trafic (voitures)
    isDriving: () => state.driving,
    hasInventoryItem: (id) => state.inventory.includes(id),
    // Écrasé par une voiture du trafic : dégâts validés côté serveur
    onRunOver: () => {
      net.send({ t: 'ouch', dmg: 15, by: 'un chauffard lyonnais' });
      navigator.vibrate?.(60);
    },
    // Jetpack ramassé à la Confluence : débloqué en permanence
    onJetpackPickup: () => {
      if (!state.hasJetpack) {
        state.hasJetpack = true;
        rememberInventoryItem('jetpack');
        ui.toast('🚀 Jetpack enfilé ! Appuie sur J pour décoller, Espace pour monter.');
        ui.spawnConfetti(20);
      } else {
        toggleJetpack();
      }
    },
    // La première utilisation du pupitre de l'aéroport range aussi l'avion
    // RC dans l'inventaire ; il pourra ensuite être déployé depuis le menu.
    onRcPlanePickup: () => {
      if (state.hasRcPlane) return;
      state.hasRcPlane = true;
      rememberInventoryItem('rc-plane');
      ui.toast('📡 Avion RC trouvé ! Il est maintenant disponible dans ton inventaire.');
      ui.spawnConfetti(20);
    },
    // Conduite des décapotables (voir world/traffic.js)
    startDrive: (car, group) => {
      // Entrer dans un véhicule range toujours le jetpack. Sans cette remise
      // à zéro, son état de vol (son + particules, et anciennement ses
      // bonbonnes en vue subjective) pouvait rester actif dans un avion.
      if (controls.flying) {
        controls.setFlying(false);
        state.flying = false;
        jetpackGuns.setTrigger(false);
        audio.jetStop();
      }
      if (!car.remoteControl) {
        controls.teleport(group.position.x, group.position.y, group.position.z);
      }
      if (car.plane && state.weaponEquipped) weapon.toggle(false);
      car.onHorn = () => audio.horn();
      car.onCrash = () => {
        audio.crash();
        navigator.vibrate?.(35);
      };
      controls.setVehicle(car);
      state.driving = true;
      audio.engineStart(car.jet ? 'jet' : car.plane ? 'prop' : 'car');
    },
    stopDrive: (car, group) => {
      controls.setVehicle(null);
      state.driving = false;
      audio.engineStop();
      if (!car.remoteControl) {
        // On descend côté conducteur ; avec une radiocommande, le joueur n'a
        // jamais quitté son emplacement au sol.
        controls.teleport(
          group.position.x + Math.cos(car.heading) * 2,
          group.position.y,
          group.position.z - Math.sin(car.heading) * 2
        );
      }
    },
  };

  // Vrai Lyon (données OpenStreetMap) si le fichier a été généré sur le
  // serveur avec tools/fetch-osm.mjs, sinon ville procédurale.
  loading.set('Construction des quais et des rues…', 74);
  await nextPaint();
  const osmData = await osmPromise;

  if (osmData?.buildings?.length > 50) {
    buildRealCity(ctx, osmData);
    camera.far = Math.max(1400, ctx.worldBound * 3);
    camera.updateProjectionMatrix();
    // Brume calée sur la TAILLE de la carte : sur le Grand Lyon (bound ~1556)
    // une densité fixe noyait toute la ville (et les fleuves) dans le gris.
    // On vise ~50 % de brume à une distance ≈ bound → on voit les deux rives,
    // les fleuves et les collines, tout en bornant le rendu lointain.
    scene.fog = new THREE.FogExp2(skyColor, Math.min(0.0011, 0.9 / (ctx.worldBound || 500)));
    ui.toast(osmData.hills
      ? 'Le GRAND Lyon chargé, de la Confluence à la Croix-Rousse — données © OpenStreetMap'
      : 'Vrai centre de Lyon chargé — données © OpenStreetMap');
  } else {
    buildCity(ctx);
  }

  // L'aviation : l'avion-banderole d'anniversaire au-dessus de la ville,
  // et l'aérodrome de l'Est avec ses coucous pilotables
  buildBannerPlane(ctx);
  buildAirport(ctx);

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
    // x positif = EST dans la projection OSM de Lyon. À l'aube (ang = 0),
    // le soleil apparaît donc côté Rhône/Alpes ; au crépuscule x devient
    // négatif, côté Saône/Fourvière. La lune, placée à l'opposé plus bas,
    // suit automatiquement le même lever est → coucher ouest pendant la nuit.
    env.sunDir.set(Math.cos(ang) * 0.9, elev, 0.42).normalize();

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
    // Plancher relevé : depuis que la brume est plus légère, les façades à
    // contre-jour (aube/crépuscule) n'étaient plus adoucies par la brume et
    // viraient au noir. Un peu plus de lumière du ciel les garde lisibles ;
    // midi (daylight=1) reste inchangé.
    hemi.intensity = HEMI_MAX * (0.6 + 0.4 * daylight);
    sun.intensity = SUN_MAX * daylight + 0.3 * env.night; // clair de lune la nuit
    sun.color.copy(ENV_DAY.sun).lerp(DUSK_TINT, dusk * 0.7)
      .lerp(ENV_NIGHT.sun, env.night);
    if (shadowsEnabled) sun.castShadow = daylight > 0.04;

    // La lumière vient du soleil le jour, de la lune la nuit. La lune suit
    // exactement l'orbite opposée au lieu d'utiliser une direction fixe.
    if (elev >= 0.02) _lightDir.copy(env.sunDir);
    else _lightDir.copy(env.sunDir).multiplyScalar(-1);
    env.lightDir = _lightDir;

    // Astres visibles : orbite centrée sur Lyon et assez large pour que les
    // levers/couchers aient lieu AU-DELÀ des limites jouables. Avant, les
    // astres restaient à 620 m du joueur et pouvaient donc surgir au milieu
    // du Grand Lyon quand on se déplaçait sur la carte.
    const astroRadius = Math.max(900, (ctx.worldBound ?? 500) * 1.55);
    // L'éloignement ne doit pas réduire leur taille apparente : on compense
    // proportionnellement la taille des sphères et de leurs halos.
    const astroScale = astroRadius / 620;
    sunMesh.position.copy(env.sunDir).multiplyScalar(astroRadius);
    sunMesh.scale.setScalar(astroScale);
    sunMesh.visible = elev > -0.12;
    halo.position.copy(sunMesh.position);
    halo.scale.setScalar(220 * astroScale);
    halo.material.opacity = Math.max(0, Math.min(1, elev * 3 + 0.25));
    halo.visible = sunMesh.visible;
    moonMesh.position.copy(env.sunDir).multiplyScalar(-astroRadius);
    moonMesh.scale.setScalar(astroScale * 1.5);
    moonMesh.visible = elev < 0.1;
    moonHalo.position.copy(moonMesh.position);
    moonHalo.scale.setScalar(120 * astroScale);
    moonHalo.material.opacity = THREE.MathUtils.clamp(-elev * 2 + 0.25, 0.18, 0.48);
    moonHalo.visible = moonMesh.visible;
  }

  // --- Progression : XP, niveaux, succès ---
  const progress = createProgress({
    onXp: (xp, opts) => ui.setXp(xp, opts),
    onUnlock: (a) => ui.achievementUnlocked(a),
  });
  ui.bindProgress(progress);
  progress.refresh(); // restaure la barre d'XP et les succès déjà gagnés

  // --- Défis quotidiens : 3 objectifs (tag/duel/arcade) + série façon
  // Wordle. `applyDaily` réagit aux réponses serveur (POST /tags, /scores,
  // ou message ws 'daily' pour les kills PvP) — toujours la même forme
  // { status, justCompleted, streakBonus }.
  function applyDaily(result) {
    if (!result?.status) return;
    ui.setDaily(result.status);
    for (const type of result.justCompleted ?? []) {
      const c = result.status.challenges.find((x) => x.type === type);
      if (c) ui.toast(`✅ Défi accompli : ${c.icon} ${c.label}`);
    }
    if (result.streakBonus) {
      const n = result.status.streak;
      ui.toast(`🔥 Série de ${n} jour${n > 1 ? 's' : ''} ! +60 XP — reviens demain !`);
      ui.spawnConfetti(30);
      audio.reward();
      progress.refresh();
    } else if (result.justCompleted?.length) {
      audio.reward();
    }
  }
  apiFetch('/daily').then((s) => ui.setDaily(s)).catch(() => {});

  const shell = createGameShell({
    onToast: ui.toast,
    onXp: (xp, xpGain) => {
      ui.setXp(xp);
      audio.reward();
      if (xpGain) ui.toast(`+${xpGain} XP`);
      progress.refresh();
    },
    onDaily: applyDaily,
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
        applyDaily(res.daily);
        progress.refresh();
      } catch (err) {
        ui.toast('Score non enregistré : ' + err.message);
      }
    },
  });

  // --- Joueur, arme, distants, tags ---
  const controls = createControls(
    camera, renderer.domElement, ctx.colliders,
    (x, z) => ctx.terrainHeight?.(x, z) ?? 0
  );
  const tutorial = createTutorial({ isTouch: IS_TOUCH });
  // Hook de debug (derrière ?debug) : téléportation/inspection pour les tests
  if (new URLSearchParams(location.search).has('debug')) {
    window.__game = { controls, ctx, state, camera, ui, renderer, quality };
  }
  // Distance du premier mur ou du sol le long d'un rayon. Mutualisée entre
  // l'arme à pied et les mitrailleuses de bord.
  const worldHitDistance = (origin, dir, maxDist) => {
    for (let d = 1; d < maxDist; d += 1.5) {
      const x = origin.x + dir.x * d, y = origin.y + dir.y * d, z = origin.z + dir.z * d;
      if (y <= (ctx.terrainHeight?.(x, z) ?? 0)) return d;
      for (const b of ctx.colliders.nearby(x, z, 1)) {
        if (x > b.minX && x < b.maxX && y > b.minY && y < b.maxY &&
            z > b.minZ && z < b.maxZ) return d;
      }
    }
    return Infinity;
  };
  const weapon = createWeapon(camera, scene, ctx.shootables, {
    onAmmoChange: (ammo, reloading, spec) => ui.setAmmo(ammo, reloading, state.weaponEquipped, spec),
    onShot: (a, b) => net.send({ t: 'shot', a, b }),
    onRocketExplosion: (point) => ctx.onRocketExplosion?.(point),
    getGroundY: () => controls.position.y,
    onWeaponChange: (spec) => ui.toast(`${spec.emoji} ${spec.nom} en main ! (2 pour changer d'arme)`),
    // Les tirs s'arrêtent sur les murs et le sol (boîtes de collision) :
    // marche de rayon grossière, appelée une fois par coup tiré
    worldHit: worldHitDistance,
  });
  // Les armes déjà ramassées lors d'une précédente session reviennent dans
  // l'inventaire sans être automatiquement sorties au démarrage.
  for (const item of state.inventory) {
    if (item.startsWith('weapon:')) weapon.give(item.slice(7), { equip: false });
  }
  if (window.__game) window.__game.weapon = weapon; // hook de debug (?debug)
  const remotes = createRemotePlayers(scene, ctx.shootables, {
    getListenerPos: () => controls.position, // enceintes des autres joueurs
    onHitRemote: (id, hit) => {
      audio.hitmarker();
      ui.hitmarker();
      navigator.vibrate?.(18);
      // Les mitrailleuses de bord ne dépendent jamais de l'arme rangée du
      // personnage. Le Mirage frappe un peu plus fort que le coucou.
      const dmg = hit?.jetpack ? 9
        : hit?.aircraft ? (hit.jet ? 32 : 25)
          : weapon.damage;
      net.send({ t: 'hit', target: id, dmg });
    },
  });
  const planeRaycaster = new THREE.Raycaster();
  ctx.onPlaneVolley = (origins, direction, aircraft) => {
    if (state.overlayOpen || state.photoMode || state.sanctuary) return;
    const range = aircraft.jet ? 520 : 280;
    const hitObjects = new Set();
    let relayEnd = null;
    for (const origin of origins) {
      planeRaycaster.set(origin, direction);
      planeRaycaster.far = range;
      const wallD = worldHitDistance(origin, direction, range);
      const hits = planeRaycaster.intersectObjects(ctx.shootables, false);
      let end;
      if (hits.length && hits[0].distance <= wallD) {
        const hit = hits[0];
        end = hit.point.clone();
        hit.aircraft = true;
        hit.jet = Boolean(aircraft.jet);
        if (!hitObjects.has(hit.object)) {
          hitObjects.add(hit.object);
          hit.object.userData.onHit?.(hit);
        }
        weapon.fx.spawnImpact(end);
      } else if (wallD <= range) {
        end = planeRaycaster.ray.at(wallD, new THREE.Vector3());
        weapon.fx.spawnImpact(end);
      } else {
        end = planeRaycaster.ray.at(range, new THREE.Vector3());
      }
      weapon.fx.spawnTracer(origin.toArray(), end.toArray(), true);
      relayEnd ??= end;
    }
    if (origins[0] && relayEnd) {
      net.send({ t: 'shot', a: origins[0].toArray(), b: relayEnd.toArray(), aircraft: 1 });
    }
    audio.gunshot();
    navigator.vibrate?.(8);
  };
  // Explosion spécifique des bombes : onde de choc au sol, colonne chaude
  // puis large chapeau de fumée. Les géométries sont partagées et seules les
  // matières (qui doivent pâlir indépendamment) sont propres à chaque nuage.
  const bombClouds = [];
  const bombStemGeo = new THREE.CylinderGeometry(1, 1.35, 1, 12);
  const bombPuffGeo = new THREE.SphereGeometry(1, 10, 7);
  const bombRingGeo = new THREE.RingGeometry(1, 1.12, 40);
  const bombSmokeHot = new THREE.Color(0xd95724);
  const bombSmokeCold = new THREE.Color(0x292d31);
  function removeBombCloud(cloud) {
    scene.remove(cloud.group);
    for (const mat of cloud.materials) mat.dispose();
  }
  function spawnBombMushroom(point, {
    scale = 1, duration = 6.2, baseBurst = true,
  } = {}) {
    if (baseBurst) weapon.fx.spawnExplosion(point);
    const p = Array.isArray(point) ? new THREE.Vector3(...point) : point;
    if (bombClouds.length >= 4) removeBombCloud(bombClouds.shift());

    const smokeMat = new THREE.MeshLambertMaterial({
      color: bombSmokeHot, transparent: true, opacity: 0.9,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffb126, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff5b2d, transparent: true, opacity: 0.72,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const group = new THREE.Group();
    group.position.copy(p);
    group.scale.setScalar(scale);
    const stem = new THREE.Mesh(bombStemGeo, smokeMat);
    group.add(stem);
    const cap = new THREE.Group();
    const puffLayout = [
      [0, 0, 0, 5.2], [-4.2, -0.2, 0, 3.8], [4.2, 0.1, 0, 4.1],
      [0, 0.5, -3.4, 3.7], [0.5, 0.2, 3.6, 3.9],
      [-2.7, 1.2, -2.5, 3.5], [3.0, 1.0, 2.3, 3.6],
    ];
    for (const [x, y, z, s] of puffLayout) {
      const puff = new THREE.Mesh(bombPuffGeo, smokeMat);
      puff.position.set(x, y, z);
      puff.scale.set(s * 1.25, s * 0.72, s);
      cap.add(puff);
    }
    group.add(cap);
    const glow = new THREE.Mesh(bombPuffGeo, glowMat);
    glow.scale.set(5, 3.5, 5);
    glow.position.y = 2.2;
    group.add(glow);
    const ring = new THREE.Mesh(bombRingGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.14;
    group.add(ring);
    const light = new THREE.PointLight(
      0xff7b28,
      80 * Math.max(0.4, scale),
      95 * scale,
      2
    );
    light.position.y = 5;
    group.add(light);
    scene.add(group);
    bombClouds.push({
      group, stem, cap, glow, ring, light,
      smokeMat, glowMat, ringMat,
      materials: [smokeMat, glowMat, ringMat], age: 0, duration,
    });
  }
  ctx.updatables.push((dt) => {
    for (let i = bombClouds.length - 1; i >= 0; i--) {
      const c = bombClouds[i];
      c.age += dt;
      const t = Math.min(1, c.age / c.duration);
      const rise = 1 - Math.pow(1 - Math.min(1, t * 1.9), 3);
      const stemH = 2 + rise * 22;
      c.stem.scale.set(1.3 + rise * 2.5, stemH, 1.3 + rise * 2.5);
      c.stem.position.y = stemH / 2;
      c.cap.position.y = 8 + rise * 18;
      c.cap.scale.setScalar(0.5 + rise * 1.25 + t * 0.4);
      c.cap.rotation.y += dt * 0.16;
      c.ring.scale.setScalar(2 + Math.min(1, t * 4) * 48);
      c.glow.scale.setScalar(5 + Math.min(1, t * 6) * 8);
      c.smokeMat.color.copy(bombSmokeHot).lerp(bombSmokeCold, Math.min(1, t * 2.1));
      c.smokeMat.opacity = Math.max(0, 0.92 * (1 - Math.pow(t, 2.4)));
      c.glowMat.opacity = Math.max(0, 0.9 * (1 - t * 5));
      c.ringMat.opacity = Math.max(0, 0.72 * (1 - t * 3.2));
      c.light.intensity = Math.max(0, 80 * (1 - t * 5));
      if (t >= 1) {
        removeBombCloud(c);
        bombClouds.splice(i, 1);
      }
    }
  });
  ctx.onPlaneBomb = (point) => {
    spawnBombMushroom(point);
    navigator.vibrate?.([70, 30, 120]);
    net.send({ t: 'bomb', p: point.toArray() });
  };
  // Le bazooka reprend exactement la silhouette de l'explosion du Mirage,
  // mais à environ un cinquième de sa taille et sur une durée plus courte.
  ctx.onRocketExplosion = (point) => {
    spawnBombMushroom(point, { scale: 0.22, duration: 2.8, baseBurst: false });
  };
  const spray = createSpray(scene, camera, ctx.taggables, {
    onToast: ui.toast,
    onModeChange: (on, paintColor) => {
      if (on && state.weaponEquipped) weapon.toggle(false);
      ui.setTagMode(on ? paintColor : null);
    },
    onSaved: (res) => {
      tutorial.tagSaved();
      if (res.xp != null) {
        ui.setXp(res.xp);
        audio.reward();
      }
      progress.refresh();
      applyDaily(res.daily);
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
    // Coup de la Garde Royale : dégâts validés (bornés) par le serveur
    onNpcAttack: () => {
      net.send({ t: 'ouch', dmg: 12, by: 'la Garde Royale' });
    },
  });

  // Armes à ramasser sur la map, du marteau au bazooka (voir world/loot.js)
  const loot = buildLoot(ctx, {
    onPickup: (id) => {
      audio.reward();
      rememberInventoryItem(`weapon:${id}`);
      weapon.give(id); // équipe (toast via onWeaponChange) ou recharge
    },
  });

  // La radio portable est désormais un vrai objet à trouver devant la salle
  // d'arcade. Elle rejoint l'inventaire persistant comme les autres objets.
  const radioPickup = buildRadioPickup(ctx, {
    hasItem: (id) => state.inventory.includes(id),
    onPickup: () => {
      state.hasRadio = true;
      rememberInventoryItem('radio');
      audio.reward();
      ui.toast('📻 Radio récupérée ! Elle est dans ton inventaire — touche B pour l’utiliser.');
      ui.spawnConfetti(20);
    },
  });

  // Momo l'armurier, au pied de la Grande Roue : quête persistante qui
  // s'appuie sur les armes déjà enregistrées dans l'inventaire du compte.
  buildWeaponQuest(ctx, {
    getStatus: () => state.arsenalQuest,
    hasItem: (id) => state.inventory.includes(id),
    getItemTarget: (id) => id === 'radio'
      ? radioPickup.target(controls.position)
      : loot.nearest(id, controls.position),
    startQuest: async () => {
      const res = await apiFetch('/quests/arsenal', {
        method: 'POST', body: JSON.stringify({ action: 'start' }),
      });
      state.arsenalQuest = res.status;
      return res;
    },
    completeQuest: async () => {
      const res = await apiFetch('/quests/arsenal', {
        method: 'POST', body: JSON.stringify({ action: 'complete' }),
      });
      state.arsenalQuest = res.status;
      if (res.xp != null) ui.setXp(res.xp);
      progress.refresh();
      return res;
    },
    onProgress: (quest) => ui.setQuest(quest),
    onReward: (res) => {
      if (!res.xpGain) return;
      ui.spawnConfetti(36);
      ui.toast(`⭐ Quête terminée : +${res.xpGain} XP`);
      audio.reward();
    },
  });

  // Carte des points d'intérêt (M) : se remplit en explorant
  const poiMap = createPoiMap(ctx, {
    getPlayer: () => ({ x: controls.position.x, z: controls.position.z, yaw: controls.yaw }),
    onToast: ui.toast,
  });

  // La Quenelle dorée : chasse au trésor toutes les 5 min, calée sur
  // l'horloge partagée (voir world/quenelle.js) — le serveur arbitre.
  const quenelle = createQuenelle(ctx, {
    send: net.send,
    notify: ui.toast,
    onWin: (msg) => {
      ui.toast(`🥇 LA QUENELLE DORÉE EST À TOI, GONE ! +${msg.xp ?? 150} XP`);
      ui.spawnConfetti(40);
      audio.reward();
      progress.refresh();
    },
  });
  net.on('quenelle', (msg) => quenelle.applyServerMsg({
    ...msg, mine: msg.by != null && msg.by === state.auth?.name,
  }));

  // Chasse au silure : les tirs sur le monstre partent au serveur avec les
  // dégâts de l'arme en main (bornés côté serveur), la mort est diffusée.
  ctx.onSilureHit = () => {
    net.send({ t: 'silure', dmg: weapon.damage });
    audio.hitmarker();
    ui.hitmarker();
  };
  net.on('silure', (msg) => {
    ctx.silure?.applyServerMsg(msg);
    if (msg.dead && msg.by === state.auth?.name) {
      ui.toast(`🎣 LE SILURE EST À TOI, GONE ! +${msg.xp ?? 120} XP`);
      ui.spawnConfetti(35);
      audio.reward();
      progress.refresh();
    }
  });

  // Grand Prix de Lyon : course chrono à checkpoints (voir world/race.js).
  // Le score envoyé décroît avec le temps (36000 − dixièmes de seconde) :
  // le classement MAX(score) garde donc le MEILLEUR temps.
  createRace(ctx, {
    setBanner: ui.setBanner,
    notify: ui.toast,
    audio,
    onFinish: async ({ ms, timeText, record }) => {
      ui.toast(`🏁 ARRIVÉE ! ${timeText}${record ? ' — record personnel de la session !' : ''}`);
      ui.spawnConfetti(30);
      audio.reward();
      try {
        const res = await apiFetch('/scores', {
          method: 'POST',
          body: JSON.stringify({ gameId: 'grand-prix', score: Math.max(1, 36000 - Math.round(ms / 100)) }),
        });
        if (res.xp != null) ui.setXp(res.xp);
        applyDaily(res.daily);
        progress.refresh();
      } catch (err) {
        ui.toast('Chrono non enregistré : ' + err.message);
      }
    },
  });

  // La Grande Roue (et tout futur manège) déplace le joueur via ce hook
  ctx.rideTick = (x, y, z) => controls.teleport(x, y, z);

  // Easter egg de la statue : voix royale, clameur… puis VENGEANCE. Les
  // gones alentour se muent en Garde Royale et chassent le régicide.
  ctx.onRoi = () => {
    audio.announce('Vive le Roi !');
    npcs.shout('VIVE LE ROI !');
    navigator.vibrate?.([90, 60, 140]); // le tonnerre gronde (son dans city.js)
    npcs.enrage(18);
    ui.toast('⚡ La foudre royale ! La Garde est à tes trousses, cours gone !');
  };

  // Capture d'écran stylée : touche C (desktop) ou bouton 📸 (tactile)
  const capture = createCapture({ renderer, scene, camera, onToast: ui.toast });

  // Avant-bras en vue subjective. En jetpack, ils portent aussi les deux
  // mitraillettes dont les bouches servent d'origine réelle aux traceurs.
  const arms = createArms(camera);

  const jetpackRaycaster = new THREE.Raycaster();
  const jetpackDirection = new THREE.Vector3();
  let jetpackTrigger = false;
  let jetpackCooldown = 0;

  function fireJetpackVolley() {
    const origins = arms.getJetpackMuzzles();
    if (!origins.length) return;
    camera.getWorldDirection(jetpackDirection).normalize();
    const range = 120;
    const hitObjects = new Set();
    let relayEnd = null;

    for (const origin of origins) {
      jetpackRaycaster.set(origin, jetpackDirection);
      jetpackRaycaster.far = range;
      const wallD = worldHitDistance(origin, jetpackDirection, range);
      const hits = jetpackRaycaster.intersectObjects(ctx.shootables, false);
      let end;
      if (hits.length && hits[0].distance <= wallD) {
        const hit = hits[0];
        hit.jetpack = true;
        end = hit.point.clone();
        if (!hitObjects.has(hit.object)) {
          hitObjects.add(hit.object);
          hit.object.userData.onHit?.(hit);
        }
        weapon.fx.spawnImpact(end);
      } else if (wallD <= range) {
        end = jetpackRaycaster.ray.at(wallD, new THREE.Vector3());
        weapon.fx.spawnImpact(end);
      } else {
        end = jetpackRaycaster.ray.at(range, new THREE.Vector3());
      }
      weapon.fx.spawnTracer(origin.toArray(), end.toArray(), true);
      relayEnd ??= end;
    }

    if (relayEnd) {
      net.send({ t: 'shot', a: origins[0].toArray(), b: relayEnd.toArray(), jetpack: 1 });
    }
    arms.pulseJetpackGuns();
    audio.gunshot();
    navigator.vibrate?.(8);
  }

  const jetpackGuns = {
    setTrigger(on) {
      jetpackTrigger = Boolean(on);
      if (jetpackTrigger && state.weaponEquipped) weapon.toggle(false);
    },
    update(dt) {
      jetpackCooldown -= dt;
      if (!controls.flying || controls.vehicle) {
        jetpackTrigger = false;
        return;
      }
      const inputOk = IS_TOUCH || state.pointerLocked;
      const canShoot = inputOk && jetpackTrigger && jetpackCooldown <= 0 &&
        !state.overlayOpen && !state.tagMode && !state.sanctuary && !state.photoMode;
      if (!canShoot) return;
      jetpackCooldown = 0.08;
      fireJetpackVolley();
    },
  };

  if (!IS_TOUCH) {
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && controls.flying && !controls.vehicle) jetpackGuns.setTrigger(true);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) jetpackGuns.setTrigger(false);
    });
  }

  // --- Enceinte portable (touche B) : boucles procédurales WebAudio, zéro
  // asset et coût quasi nul. Les autres joueurs l'entendent (champ `mus`
  // optionnel dans l'état réseau, joué en positionnel par remotes.js).
  const boombox = createMusicSource();
  const boomModel = buildBoomboxModel();
  boomModel.visible = false;
  camera.add(boomModel);
  function cycleBoombox({ tracksOnly = false } = {}) {
    if (!state.hasRadio) {
      ui.toast('🔒 Radio verrouillée : récupère-la devant la salle d’arcade pour la mission de Momo !');
      return;
    }
    state.boombox = tracksOnly
      ? (state.boombox % TRACKS.length) + 1
      : (state.boombox + 1) % (TRACKS.length + 1);
    if (state.boombox === 0) {
      boombox.stop();
      boomModel.visible = false;
      ui.toast('📻 Enceinte coupée.');
    } else {
      if (state.weaponEquipped) weapon.toggle(false);
      if (state.tagMode) spray.setMode(false);
      boombox.setVolume(0.3);
      boombox.start(state.boombox);
      boomModel.visible = true;
      ui.toast(`📻 Enceinte : ${TRACKS[state.boombox - 1].nom} — B ou touche l’enceinte pour changer !`);
      navigator.vibrate?.(12);
    }
  }

  // La façade de l'enceinte est un vrai contrôle dans le monde 3D : clic ou
  // toucher dessus passe à la piste suivante sans jamais couper la radio.
  const radioRaycaster = new THREE.Raycaster();
  const radioPointer = new THREE.Vector2();
  function isRadioAt(clientX, clientY) {
    if (!state.boombox || !boomModel.visible || state.overlayOpen) return false;
    const rect = renderer.domElement.getBoundingClientRect();
    radioPointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    camera.updateWorldMatrix(true, true);
    radioRaycaster.setFromCamera(radioPointer, camera);
    return radioRaycaster.intersectObject(boomModel, true).length > 0;
  }
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !isRadioAt(e.clientX, e.clientY)) return;
    e.preventDefault();
    e.stopPropagation();
    cycleBoombox({ tracksOnly: true });
  }, { capture: true });
  // `touchstart` est un événement séparé de `pointerdown` sur certains
  // navigateurs : on l'arrête pour que le même geste ne déplace pas la vue.
  renderer.domElement.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    if (!t || !isRadioAt(t.clientX, t.clientY)) return;
    e.preventDefault();
    e.stopPropagation();
  }, { capture: true, passive: false });

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

  // --- Jetpack : touche J (une fois ramassé à la Confluence) range/ressort
  // le jetpack ET décolle/atterrit en un geste. Le sac et ses bonbonnes ne
  // sont jamais dessinés devant la caméra ; seuls les bras/manettes/canons
  // visibles dans arms.js constituent la vue subjective.
  // Particules de propulsion mutualisées, son de réacteur modulé.
  const jetGeo = new THREE.SphereGeometry(0.12, 5, 5);
  const jetMat = new THREE.MeshBasicMaterial({
    color: 0xffb347, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const jetParticles = []; // { mesh, vel, life, maxLife }
  function toggleJetpack() {
    if (!state.hasJetpack) {
      ui.toast('🚀 Va chercher le jetpack à la pointe de la Confluence !');
      return;
    }
    if (state.driving) return;
    const on = !controls.flying;
    if (on && state.weaponEquipped) weapon.toggle(false);
    if (on && state.tagMode) spray.setMode(false);
    controls.setFlying(on);
    state.flying = on;
    if (!on) jetpackGuns.setTrigger(false);
    if (on) { audio.jetStart(); ui.toast('🚀 Jetpack sorti, décollage ! Espace pour monter, J pour ranger.'); }
    else { audio.jetStop(); ui.toast('🎒 Jetpack rangé.'); }
  }

  function toggleRcPlane() {
    if (!state.hasRcPlane) {
      ui.toast('📡 Trouve le petit avion et son pupitre sur le tarmac de l’aéroport !');
      return;
    }
    const rc = ctx.rcPlaneController;
    if (!rc) return;
    if (rc.active) {
      rc.stop();
      ui.toast('📡 Avion RC rangé dans l’inventaire.');
      return;
    }
    if (state.driving || controls.flying) {
      ui.toast('Range d’abord ton véhicule ou ton jetpack.');
      return;
    }
    if (state.weaponEquipped) weapon.toggle(false);
    const p = controls.position;
    const heading = controls.yaw;
    rc.startAt(
      p.x - Math.sin(heading) * 2.2,
      p.z - Math.cos(heading) * 2.2,
      heading
    );
  }
  function spawnJetParticles() {
    const p = controls.position;
    for (let i = 0; i < 2; i++) {
      if (jetParticles.length > 60) break;
      const m = new THREE.Mesh(jetGeo, jetMat);
      m.position.set(p.x + (Math.random() - 0.5) * 0.5, p.y + 0.2, p.z + (Math.random() - 0.5) * 0.5);
      scene.add(m);
      jetParticles.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, -3 - Math.random() * 3, (Math.random() - 0.5) * 1.5),
        life: 0.35, maxLife: 0.35,
      });
    }
  }
  function updateJetParticles(dt) {
    for (let i = jetParticles.length - 1; i >= 0; i--) {
      const s = jetParticles[i];
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.setScalar(Math.max(0.01, s.life / s.maxLife));
      if (s.life <= 0) { scene.remove(s.mesh); jetParticles.splice(i, 1); }
    }
  }

  // Active les drapeaux castShadow/receiveShadow sur tout le monde statique
  // déjà construit — TOUJOURS (même si les ombres démarrent désactivées),
  // sinon la touche O ne pourrait jamais les rallumer plus tard : c'est
  // renderer.shadowMap.enabled qui pilote le coût réel, pas ces drapeaux.
  scene.traverse((o) => {
    if (o.isMesh && !o.userData.noShadow) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

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
  net.on('hello', (msg) => {
    myNetId = msg.id;
    ui.setHp(100);
    // Lien d'invitation honoré : l'ami demandé est en ligne, on atterrit
    // juste à côté de lui (petit décalage aléatoire pour ne pas se superposer)
    if (msg.friend) {
      const [fx, fy, fz] = msg.friend.p;
      const a = Math.random() * Math.PI * 2;
      controls.teleport(fx + Math.cos(a) * 2.6, fy, fz + Math.sin(a) * 2.6);
      ui.toast(`👋 Tu as atterri à côté de ${msg.friend.name} !`);
    } else if (inviteFriend) {
      ui.toast(`${inviteFriend} n'est pas encore en ville — tu le rejoindras dès qu'il arrive.`);
    }
  });
  net.on('friendArrived', (msg) => {
    ui.toast(`🎉 ${msg.name} vient d'arriver grâce à ton invitation !`);
    ui.spawnConfetti(20);
    audio.reward();
  });
  net.on('daily', applyDaily);
  // Notification quand un gone se connecte ou s'en va (le nom vient de pjoin)
  const onlineNames = new Map(); // id -> name
  net.on('pjoin', (msg) => {
    if (!msg.name || onlineNames.has(msg.id)) return;
    onlineNames.set(msg.id, msg.name);
    ui.toast(`👋 ${msg.name} vient de se connecter !`);
    audio.hitmarker();
  });
  net.on('pleave', (msg) => {
    const name = onlineNames.get(msg.id);
    onlineNames.delete(msg.id);
    if (name) ui.toast(`💨 ${name} a quitté la ville.`);
  });
  net.on('shot', (msg) => {
    weapon.fx.spawnTracer(msg.a, msg.b, Boolean(msg.aircraft));
    weapon.fx.spawnImpact(msg.b);
  });
  net.on('explosion', (msg) => {
    spawnBombMushroom(msg.p);
    navigator.vibrate?.([60, 25, 90]);
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
      const sp = spawnPoint();
      for (const abort of ctx.abortRides) abort();
      // Mort au volant : on coupe le moteur, la voiture reste sur place
      if (state.driving) {
        controls.setVehicle(null);
        state.driving = false;
        audio.engineStop();
      }
      // Mort en vol : on coupe le jetpack (mais on le garde en poche)
      if (controls.flying) {
        controls.setFlying(false);
        state.flying = false;
        jetpackGuns.setTrigger(false);
        audio.jetStop();
      }
      npcs.calm(); // la Garde a eu sa vengeance
      controls.teleport(sp.x, sp.y, sp.z, sp.ry);
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
  net.connect(() => controls.netState(), inviteFriend ? { ami: inviteFriend } : {});
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
    // C : ouvre le mode photo (zoom à la molette), C à nouveau déclenche
    if (e.code === 'KeyC') {
      if (capture.modeOn) capture.take();
      else capture.toggleMode(true);
    }
    if (e.code === 'KeyJ') toggleJetpack();
    if (e.code === 'KeyK' && controls.vehicle?.jet) controls.dropPlaneBomb();
    if (e.code === 'KeyH' && controls.vehicle?.plane) controls.togglePlaneCamera();
    if (e.code === 'KeyB') cycleBoombox();
    if (e.code === 'Digit3') emote(0);
    if (e.code === 'Digit4') emote(1);
    if (e.code === 'Digit5') emote(2);
    if (e.code === 'KeyF') spray.toggleMode();
    if (e.code === 'KeyG') spray.stampTag();
    if (e.code === 'KeyT') tagEditor.open();
    if (e.code === 'KeyL') ui.toggleLeaderboards();
    if (e.code === 'KeyP') ui.toggleAdmin();
    if (e.code === 'KeyV') voice.toggleMic();
    if (e.code === 'KeyO') {
      const lvl = quality.cycle();
      ui.toast(`🖥️ Graphismes : ${quality.label} — ${lvl === 'bas' ? 'ombres coupées, plus fluide' : lvl === 'moyen' ? 'ombres légères' : 'ombres complètes'} (O pour changer)`);
    }
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
      jetpack: () => toggleJetpack(),
      jetpackGuns,
      rcPlane: () => toggleRcPlane(),
      interact: () => nearestInteractable?.action(),
      map: () => poiMap.toggle(),
      radio: () => cycleBoombox(),
      admin: () => ui.toggleAdmin(),
      invite: () => ui.invite(),
      quality,
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
  let wetToastAt = 0;

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);

    controls.update(dt);
    // Les outils tenus en main ne peuvent pas réapparaître via un raccourci
    // pendant le vol : les mains restent exclusivement sur les manettes.
    if (controls.flying && state.weaponEquipped) weapon.toggle(false);
    if (controls.flying && state.tagMode) spray.setMode(false);
    // Une radio allumée est réellement tenue : aucun raccourci ne peut faire
    // apparaître une arme ou une bombe de peinture dans la seconde main.
    if (state.boombox && !controls.flying && !controls.vehicle) {
      if (state.weaponEquipped) weapon.toggle(false);
      if (state.tagMode) spray.setMode(false);
    }
    weapon.update(dt, controls.isMoving());
    // Bras en vue subjective : masqués au volant/aux commandes (caméra
    // externe ou poste de pilotage), sinon la pose suit ce qui est en main
    arms.setVisible(!controls.vehicle);
    const armMode = controls.flying ? 'jetpack'
      : state.weaponEquipped ? 'weapon'
        : state.boombox ? 'boombox' : 'idle';
    arms.update(dt, armMode, controls.isMoving(), weapon.holder);
    jetpackGuns.update(dt);
    // La radio peut continuer à jouer en vol, mais son modèle porté ne doit
    // jamais flotter devant la caméra en jetpack ou dans un avion.
    boomModel.visible = Boolean(state.boombox && !controls.flying && !controls.vehicle);
    spray.update(dt);
    remotes.update();
    voice.update();
    range.update(dt);
    npcs.update(dt);
    for (const u of ctx.updatables) u(dt);

    // L'arme range la bombe (et inversement)
    if (state.weaponEquipped && state.tagMode) spray.setMode(false);

    // Moteur de la décapotable : la hauteur suit la vitesse
    if (state.driving) {
      const engineTopSpeed = controls.vehicle?.jet ? 220 : controls.vehicle?.plane ? 68 : 38;
      audio.engineUpdate(Math.min(1, Math.abs(controls.vehicle?.speed ?? 0) / engineTopSpeed));
    }

    // Jetpack : poussée sonore + gerbe de particules sous les pieds
    if (controls.flying) {
      audio.jetThrust(controls.flyThrust);
      if (controls.flyThrust) spawnJetParticles();
    }
    updateJetParticles(dt);

    // Tombé dans le fleuve : petit message (la vraie nage viendra plus tard)
    if (controls.position.y < -1.2 && !state.driving && infoTimer <= 0 && !wetToastAt) {
      wetToastAt = Date.now();
      ui.toast('🌊 Glagla ! Rejoins un escalier de quai pour remonter.');
    } else if (controls.position.y > -0.5 && wetToastAt && Date.now() - wetToastAt > 8000) {
      wetToastAt = 0;
    }

    // Bruits de pas : cadence et volume selon la vitesse réelle
    const speed = controls.speed();
    if (controls.onGround && speed > 1.2 && !state.driving) {
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

    tutorial.update(controls.position, ARCADE);
    renderer.render(scene, camera);
  }
  loop();
  loading.done();
  tutorial.start();

  ui.toast('Bienvenue à Lyon ! La salle d’arcade est au nord de Bellecour.');
  // Signale le palier auto-détecté seulement s'il a réduit la qualité (rien
  // à dire pour une machine costaud qui tourne déjà en Élevé par défaut).
  if (quality.level !== 'eleve') {
    setTimeout(() => {
      ui.toast(`🖥️ Graphismes réglés sur ${quality.label} pour rester fluide — touche O pour changer.`);
    }, 4000);
  }
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

// Enceinte portable tenue d'une main sur le bord gauche de la vue.
function buildBoomboxModel() {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x23262d });
  const rim = new THREE.MeshLambertMaterial({ color: 0x697381 });
  const cone = new THREE.MeshLambertMaterial({ color: 0x343b46 });
  const cap = new THREE.MeshLambertMaterial({ color: 0x11151b });
  const accent = new THREE.MeshLambertMaterial({ color: 0xff3df0, emissive: 0x3b082f });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.23, 0.14), dark);
  g.add(body);
  for (const dx of [-0.105, 0.105]) {
    const speakerRim = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 16), rim);
    speakerRim.rotation.x = Math.PI / 2;
    speakerRim.position.set(dx, -0.015, 0.078);
    g.add(speakerRim);
    const speakerCone = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.062, 0.014, 16), cone);
    speakerCone.rotation.x = Math.PI / 2;
    speakerCone.position.set(dx, -0.015, 0.091);
    g.add(speakerCone);
    const dustCap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 12), cap);
    dustCap.rotation.x = Math.PI / 2;
    dustCap.position.set(dx, -0.015, 0.103);
    g.add(dustCap);
  }
  const display = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.025, 0.012), accent);
  display.position.set(0, 0.075, 0.079);
  g.add(display);
  // Poignée semi-circulaire : la main gauche attrape son montant droit.
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.014, 6, 16, Math.PI), rim);
  handle.position.y = 0.125;
  g.add(handle);
  // Volume invisible mais raycastable, un peu plus large que la façade pour
  // rendre le toucher confortable sur téléphone.
  const hitArea = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.34, 0.22),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hitArea.userData.radioControl = true;
  g.add(hitArea);
  // Haut-parleurs face à la caméra (+z), radio déportée vers l'extérieur.
  g.position.set(-0.5, -0.26, -0.76);
  g.rotation.set(-0.05, -0.05, -0.08);
  return g;
}
