import { state } from '../state.js';
import { buildAvatar, avatarsEnabled, avatarFor } from './avatars.js';

// TON PROPRE CORPS, à la première personne : le même personnage que celui
// que les autres voient (avatarFor(pseudo)). En baissant les yeux, on voit
// son torse et ses jambes marcher, courir, s'accroupir — et son ombre au
// sol. La tête et les bras de l'avatar sont escamotés (os à l'échelle ~0) :
// les bras visibles restent ceux de l'arme (player/arms.js), au premier plan.
// Rien au palier Bas, ni en véhicule, en vol, en mode photo ou en killcam.
export function createSelfBody(ctx, { controls, getName }) {
  let body = null;
  let lastX = 0, lastZ = 0, speed = 0;
  if (avatarsEnabled()) {
    buildAvatar(avatarFor(getName())).then((av) => {
      for (const n of ['Bip01_Neck', 'Bip01_Head', 'Bip01_L_Clavicle', 'Bip01_R_Clavicle']) {
        av.bone(n)?.scale.setScalar(0.0001);
      }
      av.group.traverse((o) => { o.frustumCulled = false; });
      av.group.visible = false;
      ctx.scene.add(av.group);
      body = av;
    }).catch(() => {});
  }

  // À appeler à chaque image, après controls.update
  function update(dt) {
    if (!body) return;
    const g = body.group;
    const show = !controls.vehicle && !controls.flying && !state.killcam &&
      !state.photoMode && !state.driving && !ctx.inPocketHidden;
    if (g.visible !== show) g.visible = show;
    if (!show) return;
    const p = controls.position, yaw = controls.yaw;
    // un peu en retrait de l'œil : le torse ne mange pas l'image quand on
    // regarde ses pieds
    const back = 0.3;
    g.position.set(p.x + Math.sin(yaw) * back, p.y, p.z + Math.cos(yaw) * back);
    g.rotation.y = yaw;
    const v = dt > 0 ? Math.hypot(p.x - lastX, p.z - lastZ) / dt : 0;
    lastX = p.x; lastZ = p.z;
    speed += (Math.min(v, 12) - speed) * Math.min(1, dt * 10);
    g.userData.crouch = controls.crouched;
    g.userData.baseY = p.y;
    body.animate(0, (controls.onGround ? speed : 0) * 2.6);
  }

  return { update };
}
