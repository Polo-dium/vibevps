import * as THREE from 'three';
import { buildBellecourArena } from './arena.js';
import { setRainFloor } from './weather.js';
import { setRoadWetness } from '../render/road.js';

// LES LIEUX EN HAUTE FIDÉLITÉ 🏛️
//
// Entrer dans la zone du Roi de la colline téléporte dans une reconstitution
// dense et soignée du lieu. Le truc : la carte HD est bâtie DANS la même
// scène, très loin de la ville (OFFSET). Le masquage par distance déjà en
// place fait alors tout le travail — la ville entière disparaît d'elle-même
// quand on est là-bas, et la carte HD disparaît quand on est en ville. Pas
// de seconde scène à gréer, pas de lumières ni de ciel à dupliquer.
//
// Le décor fixe est cuit en couleurs de sommets (flattenColored) : on peut
// donc se permettre beaucoup plus de détail qu'en ville pour un coût de
// rendu dérisoire.
const OFFSET = 20000; // en x, bien au-delà de toute portée de vue

// Quels POI du Roi de la colline mènent à quelle carte HD. Les trois points
// situés SUR la place mènent à Bellecour ; les autres restent à bâtir.
const ROUTES = {
  arcade: 'bellecour',
  petanque: 'bellecour',
  roue: 'bellecour',
};

export function createHiFi(ctx, { notify } = {}) {
  const maps = new Map(); // id -> { group, spawn }
  let active = null;      // id de la carte où l'on se trouve
  let backTo = null;      // position de retour en ville
  let dryBack = 0;        // humidité de la chaussée à rétablir au retour

  function build(id) {
    if (maps.has(id)) return maps.get(id);
    const group = new THREE.Group();
    group.position.set(OFFSET, 0, 0);
    ctx.scene.add(group);
    const made = id === 'bellecour' ? buildBellecourArena(ctx, group, OFFSET) : null;
    if (!made) { ctx.scene.remove(group); return null; }
    maps.set(id, made);
    return made;
  }

  function enter(poiId, nom) {
    const mapId = ROUTES[poiId];
    if (!mapId) {
      notify?.(`🚧 ${nom ?? 'Ce lieu'} n'a pas encore sa version haute fidélité — ça arrive !`);
      return false;
    }
    const map = build(mapId);
    if (!map) return false;
    const p = ctx.playerPos();
    backTo = { x: p.x, y: p.y, z: p.z };
    active = mapId;
    ctx.inHiFi = true;
    // L'arène vit sous l'orage : pluie, ciel plombé, sol détrempé d'entrée
    setRainFloor(0.85);
    dryBack = setRoadWetness(1);
    ctx.teleport?.(OFFSET + map.spawn.x, map.spawn.y, map.spawn.z, map.spawn.ry);
    notify?.('⛈️ Arène de Bellecour — conteneurs, orage et gones armés. Sortie par le portail doré.');
    return true;
  }

  function exit() {
    if (!active || !backTo) return;
    active = null;
    ctx.inHiFi = false;
    setRainFloor(0);
    setRoadWetness(dryBack);
    ctx.teleport?.(backTo.x, backTo.y + 0.2, backTo.z);
    notify?.('↩️ Retour dans Lyon.');
  }

  return { enter, exit, get active() { return active; } };
}
