// Conversion Rocketbox (FBX + PNG 512) → GLB animé, dans le navigateur (three du projet)
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = require('path').resolve(__dirname, '../../client/public/avatars') + '/';
const NAMES = (process.argv[2] || 'Female_Adult_01').split(',');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('PAGEERR', e.message));
  p.on('console', (m) => { if (m.text().startsWith('CV')) console.log(m.text()); });
  await p.goto('http://localhost:5173/', { waitUntil: 'load' });
  for (const n of NAMES) {
    const b64 = await p.evaluate(async (n0) => {
      let n = n0;
      const { THREE, FBXLoader, GLTFExporter, mergeVertices } = await import('/src/_pv.js');
      const ANIM = n.startsWith('ANIM_');
      if (ANIM) n = n.slice(5);
      const fem = /Female/.test(n);
      const mgr = new THREE.LoadingManager();
      mgr.addHandler(/\.tga$/i, new THREE.TextureLoader(mgr));
      mgr.setURLModifier((u) => {
        if (u.startsWith('blob:') || u.startsWith('data:') || /\.fbx$/i.test(u)) return u;
        const f = u.split(/[\\/]/).pop().replace(/\.tga$/i, '.png');
        return '/_pv/rb/' + n + '/Textures/' + f;
      });
      const ld = new FBXLoader(mgr);
      const av = await ld.loadAsync('/_pv/rb/' + n + '/Export/' + n + '.fbx');
      // les textures doivent être chargées avant l'export
      await new Promise((r) => { if (mgr.itemsLoaded >= mgr.itemsTotal) r(); else mgr.onLoad = r; setTimeout(r, 8000); });
      const kill = [];
      av.traverse((o) => { if (o.isLight || o.isCamera) kill.push(o); });
      kill.forEach((o) => o.removeFromParent());
      const bones = new Set();
      let tris = 0, nb = 0;
      av.traverse((o) => {
        if (o.isBone || o.name.startsWith('Bip01')) bones.add(o.name);
        if (!o.isMesh) return;
        o.geometry.deleteAttribute('color');
        // FBX non soudé (3 sommets par triangle) : soudure, puis UN groupe
        // par matériau (l'export en faisait 14 primitives)
        const g0 = o.geometry, groups = g0.groups.length ? g0.groups : [{ start: 0, count: g0.index ? g0.index.count : g0.attributes.position.count, materialIndex: 0 }];
        const g1 = mergeVertices(g0, 1e-5);
        const idx = g1.index.array, byMat = new Map();
        for (const gr of groups) { const l = byMat.get(gr.materialIndex) ?? []; for (let k = gr.start; k < gr.start + gr.count; k++) l.push(idx[k]); byMat.set(gr.materialIndex, l); }
        const all = []; g1.clearGroups();
        for (const [mi, l] of [...byMat].sort((a, b2) => a[0] - b2[0])) { g1.addGroup(all.length, l.length, mi); all.push(...l); }
        g1.setIndex(all);
        o.geometry = g1;
        console.log('CV verts', g0.attributes.position.count, '->', g1.attributes.position.count);
        tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
        if (o.isSkinnedMesh) nb = Math.max(nb, o.skeleton.bones.length);
        const mats = [].concat(o.material).map((m) => {
          const alpha = /opacity/i.test(m.name) || !!m.alphaMap;
          const map = m.map ?? null;
          // couleur : JPEG (léger) ; cheveux/cils à alpha : PNG
          if (map) { map.colorSpace = THREE.SRGBColorSpace; map.userData.mimeType = alpha ? 'image/png' : 'image/jpeg'; }
          return new THREE.MeshStandardMaterial({ name: m.name, map, roughness: 0.8, metalness: 0,
            ...(alpha ? { alphaTest: 0.5, side: THREE.DoubleSide } : {}) });
        });
        o.material = Array.isArray(o.material) ? mats : mats[0];
      });
      const clips = [];
      if (ANIM) for (const [name, file, cut] of [['idle', 'idle', 5], ['walk', 'walk', 0], ['talk', 'talk', 5], ['sit', 'sit', 6]]) {
        const a = await new FBXLoader().loadAsync('/_pv/rb/anim/' + (fem ? 'f_' : 'm_') + file + '.fbx');
        let take = a.animations[0];
        // rotations de tous les os ; position du bassin (Bip01) seulement
        const tracks = take.tracks.filter((t) => bones.has(t.name.slice(0, t.name.lastIndexOf('.'))) && !t.name.endsWith('.scale') &&
          (!t.name.endsWith('.position') || t.name === 'Bip01.position'));
        let clip = new THREE.AnimationClip(name, take.duration, tracks);
        if (cut && clip.duration > cut) {
          for (const t of clip.tracks) t.trim(0, cut);
          clip = new THREE.AnimationClip(name, cut, clip.tracks);
        }
        // 15 images/s suffisent (interpolation entre les clés)
        for (const t of clip.tracks) {
          const st = t.getValueSize(), keep = [];
          for (let k = 0; k < t.times.length; k++) if (k % 2 === 0 || k === t.times.length - 1) keep.push(k);
          t.times = Float32Array.from(keep, (k) => t.times[k]);
          const v = new Float32Array(keep.length * st);
          keep.forEach((k, i) => v.set(t.values.subarray(k * st, k * st + st), i * st));
          t.values = v;
        }
        // sur place : la marche n'avance pas (le jeu déplace le personnage)
        const root = clip.tracks.find((t) => t.name === 'Bip01.position');
        if (root && name === 'walk') { const v = root.values, x = v[0], z = v[2]; for (let i = 0; i < v.length; i += 3) { v[i] = x; v[i + 2] = z; } }
        clips.push(clip);
        console.log('CV', n, name, clip.duration.toFixed(2), clip.tracks.length);
      }
      av.scale.setScalar(0.01); // centimètres → mètres
      av.updateMatrixWorld(true);
      const h = new THREE.Box3().setFromObject(av).getSize(new THREE.Vector3()).y;
      const scene = new THREE.Scene();
      // fichier d'animations : le squelette seul (pas de maillage)
      if (ANIM) { const m = []; av.traverse((o) => { if (o.isMesh) m.push(o); }); m.forEach((o) => o.removeFromParent()); }
      scene.add(av);
      const glb = await new GLTFExporter().parseAsync(scene, { binary: true, animations: clips, onlyVisible: false });
      console.log('CV', n, 'tris', tris | 0, 'bones', nb, 'h', h.toFixed(2), 'bytes', glb.byteLength);
      let s = ''; const u8 = new Uint8Array(glb);
      for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s);
    }, n);
    const out = n.startsWith('ANIM_') ? 'anim_' + (/Female/.test(n) ? 'f' : 'm') : n.toLowerCase();
    fs.writeFileSync(OUT + out + '.glb', Buffer.from(b64, 'base64'));
  }
  await b.close();
})();
