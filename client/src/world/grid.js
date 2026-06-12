// Grille spatiale pour les colliders AABB : indispensable quand la ville
// réelle apporte des milliers de bâtiments. Compatible avec l'API tableau
// (push + itération) utilisée par tous les modules.
const CELL = 12;

export class ColliderGrid {
  constructor() {
    this.boxes = [];
    this.cells = new Map(); // "cx,cz" -> box[]
  }

  push(box) {
    this.boxes.push(box);
    const x0 = Math.floor(box.minX / CELL), x1 = Math.floor(box.maxX / CELL);
    const z0 = Math.floor(box.minZ / CELL), z1 = Math.floor(box.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = cx + ',' + cz;
        let arr = this.cells.get(key);
        if (!arr) {
          arr = [];
          this.cells.set(key, arr);
        }
        arr.push(box);
      }
    }
  }

  // Boîtes proches d'un point (rayon en mètres)
  nearby(x, z, r = 2) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    const out = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.cells.get(cx + ',' + cz);
        if (arr) {
          for (const b of arr) {
            if (!out.includes(b)) out.push(b);
          }
        }
      }
    }
    return out;
  }

  get length() { return this.boxes.length; }
  [Symbol.iterator]() { return this.boxes[Symbol.iterator](); }
}
