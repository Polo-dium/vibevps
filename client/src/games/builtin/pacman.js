// Pac-Man — borne d'arcade intégrée
export default String.raw`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>PAC-MAN</title>
<style>
  html, body { margin:0; padding:0; width:100%; height:100%; background:#000; overflow:hidden; }
  body { display:flex; align-items:center; justify-content:center; }
  canvas { max-width:100%; max-height:100%; image-rendering:pixelated; background:#000; }
</style>
</head>
<body>
<canvas id="cv" width="360" height="480"></canvas>
<script>
(function(){
  'use strict';
  var cv = document.getElementById('cv');
  var ctx = cv.getContext('2d');
  var T = 18, MCOLS = 19, MROWS = 21;
  var OX = (360 - MCOLS * T) / 2, OY = 56;
  var MAZE = [
    '###################',
    '#........#........#',
    '#o##.###.#.###.##o#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.###.#.###.####',
    '####.#.......#.####',
    '####.#.##=##.#.####',
    ' ....#.#GGG#.#.... ',
    '####.#.#####.#.####',
    '####.#.......#.####',
    '####.#.#####.#.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o.#.....P.....#.o#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '#.######.#.######.#',
    '#.................#',
    '###################'
  ];
  var PAC_START = {x:9, y:15}, GHOST_EXIT = {x:9, y:7};
  var HOUSE = [{x:8,y:9},{x:9,y:9},{x:10,y:9}];
  var GHOST_DEFS = [
    { c:'#ff2020', house:false, t:0 },
    { c:'#ffb8ff', house:true,  t:2 },
    { c:'#00ffff', house:true,  t:4 },
    { c:'#ffb850', house:true,  t:6 }
  ];
  var DIRS = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];

  var pell, pelletsLeft, pac, ghosts, score, lives, level, state, scoreSent;
  var frightT, eatChain, freezeT, freezeMsg, anim;

  function sendProgress(){ parent.postMessage({type:'arcade:progress', score: score}, '*'); }
  function addScore(n){ score += n; sendProgress(); }
  function wrapC(c){ return ((c % MCOLS) + MCOLS) % MCOLS; }
  function tile(c, r){
    if (r < 0 || r >= MROWS) return '#';
    return MAZE[r].charAt(wrapC(c));
  }
  function passable(c, r){
    var ch = tile(c, r);
    return ch !== '#' && ch !== '=' && ch !== 'G';
  }

  function buildPellets(){
    pell = []; pelletsLeft = 0;
    for (var r = 0; r < MROWS; r++) {
      pell[r] = [];
      for (var c = 0; c < MCOLS; c++) {
        var ch = MAZE[r].charAt(c);
        pell[r][c] = ch === '.' ? 1 : (ch === 'o' ? 2 : 0);
        if (pell[r][c]) pelletsLeft++;
      }
    }
  }
  function mkActor(c, r, speed){
    return { tx:c, ty:r, x:c, y:r, from:{x:c,y:r}, to:{x:c,y:r}, dir:null, prog:0, moving:false, speed:speed };
  }
  function speedMul(){ return Math.min(1.5, 1 + (level - 1) * 0.07); }

  function resetActors(quick){
    pac = mkActor(PAC_START.x, PAC_START.y, 5.6 * speedMul());
    pac.nextDir = null;
    ghosts = [];
    for (var i = 0; i < 4; i++) {
      var d = GHOST_DEFS[i];
      var g;
      if (d.house) {
        g = mkActor(HOUSE[(i - 1) % 3].x, HOUSE[(i - 1) % 3].y, 5.1 * speedMul());
        g.state = 'house';
        g.houseT = quick ? d.t * 0.5 : d.t;
      } else {
        g = mkActor(GHOST_EXIT.x, GHOST_EXIT.y, 5.1 * speedMul());
        g.state = 'active';
      }
      g.color = d.c; g.red = (i === 0); g.scared = false;
      ghosts.push(g);
    }
    frightT = 0; eatChain = 0;
  }
  function reset(){
    score = 0; lives = 3; level = 1; scoreSent = false;
    buildPellets();
    resetActors(false);
    state = 'play';
    freezeT = 1.4; freezeMsg = 'PRET !';
    sendProgress();
  }
  function doGameOver(){
    state = 'over';
    if (!scoreSent) { scoreSent = true; parent.postMessage({type:'arcade:score', score: score}, '*'); }
  }

  // ---- movement ----
  function startMove(a, d){
    a.dir = d;
    a.from = {x:a.tx, y:a.ty};
    a.to = {x:a.tx + d.x, y:a.ty + d.y};
    a.prog = 0; a.moving = true;
  }
  function arrive(a){
    a.tx = wrapC(a.to.x); a.ty = a.to.y;
    a.x = a.tx; a.y = a.ty;
    a.moving = false;
  }
  function updatePos(a){
    a.x = a.from.x + (a.to.x - a.from.x) * a.prog;
    a.y = a.from.y + (a.to.y - a.from.y) * a.prog;
  }
  function pacDecide(){
    if (pac.nextDir && passable(pac.tx + pac.nextDir.x, pac.ty + pac.nextDir.y)) {
      startMove(pac, pac.nextDir);
    } else if (pac.dir && passable(pac.tx + pac.dir.x, pac.ty + pac.dir.y)) {
      startMove(pac, pac.dir);
    }
  }
  function ghostDecide(g){
    var cand = [], i, d;
    for (i = 0; i < 4; i++) {
      d = DIRS[i];
      if (g.dir && d.x === -g.dir.x && d.y === -g.dir.y) continue; // no reversal
      if (passable(g.tx + d.x, g.ty + d.y)) cand.push(d);
    }
    if (cand.length === 0) { // dead end: allow reversal
      for (i = 0; i < 4; i++) {
        d = DIRS[i];
        if (passable(g.tx + d.x, g.ty + d.y)) cand.push(d);
      }
    }
    if (cand.length === 0) return;
    var pick;
    if (g.scared || !g.red) {
      pick = cand[Math.floor(Math.random() * cand.length)];
      if (g.scared && g.red) { // scared red flees: maximize distance
        var best = -1;
        for (i = 0; i < cand.length; i++) {
          var dx0 = wrapC(g.tx + cand[i].x) - pac.x, dy0 = g.ty + cand[i].y - pac.y;
          var dd = dx0 * dx0 + dy0 * dy0;
          if (dd > best) { best = dd; pick = cand[i]; }
        }
      }
    } else { // red chases: minimize distance to pacman
      var bestD = Infinity; pick = cand[0];
      for (i = 0; i < cand.length; i++) {
        var dx = wrapC(g.tx + cand[i].x) - pac.x, dy = g.ty + cand[i].y - pac.y;
        var dist = dx * dx + dy * dy;
        if (dist < bestD) { bestD = dist; pick = cand[i]; }
      }
    }
    startMove(g, pick);
  }
  function reverseGhost(g){
    if (!g.moving) { g.dir = g.dir ? {x:-g.dir.x, y:-g.dir.y} : null; return; }
    var f = g.from; g.from = {x:g.to.x, y:g.to.y}; g.to = f;
    g.prog = 1 - g.prog;
    g.dir = {x:-g.dir.x, y:-g.dir.y};
    g.tx = wrapC(g.from.x); g.ty = g.from.y;
  }
  function moveActor(a, dt, decideFn){
    if (!a.moving) { decideFn(a); if (!a.moving) return; }
    a.prog += a.speed * (a.scared ? 0.6 : 1) * dt;
    while (a.prog >= 1) {
      var left = a.prog - 1;
      arrive(a);
      decideFn(a);
      if (!a.moving) { a.prog = 0; return; }
      a.prog = left;
    }
    updatePos(a);
  }

  function eatTile(){
    var p = pell[pac.ty][pac.tx];
    if (!p) return;
    pell[pac.ty][pac.tx] = 0;
    pelletsLeft--;
    if (p === 1) addScore(10);
    else {
      addScore(50);
      frightT = 8; eatChain = 0;
      for (var i = 0; i < ghosts.length; i++) {
        if (ghosts[i].state === 'active') { ghosts[i].scared = true; reverseGhost(ghosts[i]); }
      }
    }
    if (pelletsLeft === 0) {
      level++;
      buildPellets();
      resetActors(false);
      freezeT = 2; freezeMsg = 'NIVEAU ' + level;
    }
  }
  function loseLife(){
    lives--;
    if (lives <= 0) { doGameOver(); return; }
    resetActors(true);
    freezeT = 1.4; freezeMsg = 'PRET !';
  }
  function checkGhosts(){
    for (var i = 0; i < ghosts.length; i++) {
      var g = ghosts[i];
      if (g.state !== 'active') continue;
      var dx = g.x - pac.x, dy = g.y - pac.y;
      if (dx * dx + dy * dy < 0.45) {
        if (g.scared) {
          var pts = 200 * Math.pow(2, eatChain);
          eatChain = Math.min(3, eatChain + 1);
          addScore(pts);
          g.state = 'house'; g.scared = false; g.houseT = 3;
          g.tx = HOUSE[1].x; g.ty = HOUSE[1].y; g.x = g.tx; g.y = g.ty;
          g.moving = false; g.dir = null;
        } else {
          loseLife();
          return;
        }
      }
    }
  }

  function update(dt){
    anim += dt;
    if (freezeT > 0) { freezeT -= dt; return; }
    if (frightT > 0) {
      frightT -= dt;
      if (frightT <= 0) {
        frightT = 0;
        for (var i = 0; i < ghosts.length; i++) ghosts[i].scared = false;
      }
    }
    moveActor(pac, dt, pacDecide);
    eatTile();
    for (var j = 0; j < ghosts.length; j++) {
      var g = ghosts[j];
      if (g.state === 'house') {
        g.houseT -= dt;
        if (g.houseT <= 0) {
          g.state = 'active';
          g.tx = GHOST_EXIT.x; g.ty = GHOST_EXIT.y; g.x = g.tx; g.y = g.ty;
          g.moving = false; g.dir = null;
        }
      } else {
        moveActor(g, dt, ghostDecide);
      }
    }
    checkGhosts();
  }

  // ---- input ----
  window.addEventListener('keydown', function(e){
    var code = e.code;
    if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'Space') e.preventDefault();
    if (state === 'idle') { reset(); }
    else if (state === 'over') { if (code === 'Enter') reset(); return; }
    if (code === 'ArrowLeft') pac.nextDir = {x:-1, y:0};
    else if (code === 'ArrowRight') pac.nextDir = {x:1, y:0};
    else if (code === 'ArrowUp') pac.nextDir = {x:0, y:-1};
    else if (code === 'ArrowDown') pac.nextDir = {x:0, y:1};
  });
  window.addEventListener('keyup', function(){});

  // ---- render ----
  function px(c){ return OX + c * T + T / 2; }
  function py(r){ return OY + r * T + T / 2; }
  function drawMaze(){
    for (var r = 0; r < MROWS; r++) for (var c = 0; c < MCOLS; c++) {
      var ch = MAZE[r].charAt(c);
      if (ch === '#') {
        ctx.fillStyle = '#000a2e';
        ctx.fillRect(OX + c * T, OY + r * T, T, T);
        ctx.strokeStyle = '#2244ff'; ctx.lineWidth = 1;
        ctx.strokeRect(OX + c * T + 2.5, OY + r * T + 2.5, T - 5, T - 5);
      } else if (ch === '=') {
        ctx.fillStyle = '#ff80c0';
        ctx.fillRect(OX + c * T, OY + r * T + T / 2 - 1, T, 2);
      }
      var p = pell && pell[r] ? pell[r][c] : 0;
      if (p === 1) {
        ctx.fillStyle = '#ffd0a0';
        ctx.fillRect(px(c) - 1.5, py(r) - 1.5, 3, 3);
      } else if (p === 2) {
        if (Math.floor(anim * 4) % 2 === 0) {
          ctx.shadowColor = '#ffd0a0'; ctx.shadowBlur = 8; ctx.fillStyle = '#ffd0a0';
          ctx.beginPath(); ctx.arc(px(c), py(r), 5, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }
  }
  function drawPac(x, y, size, dir, mouth){
    var a = Math.atan2(dir ? dir.y : 0, dir ? (dir.x || (dir.y ? 0 : 1)) : 1);
    if (dir && dir.x === 0 && dir.y === 0) a = 0;
    ctx.shadowColor = '#ff0'; ctx.shadowBlur = 10; ctx.fillStyle = '#ff0';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, size, a + mouth, a + Math.PI * 2 - mouth);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
  }
  function drawGhost(g){
    var x = px(0) + g.x * T - T / 2 + OX * 0 ; // computed below properly
    x = OX + g.x * T + T / 2;
    var y = OY + g.y * T + T / 2;
    var rr = T / 2 - 1;
    var col = g.color;
    if (g.scared) col = (frightT < 2 && Math.floor(anim * 6) % 2 === 0) ? '#fff' : '#2040ff';
    ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y - 1, rr, Math.PI, 0);
    ctx.lineTo(x + rr, y + rr - 2);
    for (var i = 2; i >= -2; i--) ctx.lineTo(x + (i / 2) * rr - (i % 2 === 0 ? 0 : 0), y + rr - 2 - ((i + 2) % 2) * 3);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    // eyes
    ctx.fillStyle = '#fff';
    var ex = g.dir ? g.dir.x * 1.5 : 0, ey = g.dir ? g.dir.y * 1.5 : 0;
    ctx.beginPath(); ctx.arc(x - 3 + ex, y - 2 + ey, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 3 + ex, y - 2 + ey, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = g.scared ? '#f00' : '#001';
    ctx.beginPath(); ctx.arc(x - 3 + ex * 1.6, y - 2 + ey * 1.6, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 3 + ex * 1.6, y - 2 + ey * 1.6, 1.3, 0, Math.PI * 2); ctx.fill();
  }
  function draw(){
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 360, 480);
    ctx.font = 'bold 14px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = '#ff0'; ctx.shadowColor = '#ff0'; ctx.shadowBlur = 8;
    ctx.fillText('PAC-MAN', 10, 22);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
    ctx.fillText('SCORE ' + (score || 0), 350, 22);
    ctx.textAlign = 'left'; ctx.fillStyle = '#0ff'; ctx.font = '10px monospace';
    ctx.fillText('NIV ' + (level || 1), 10, 40);

    drawMaze();

    if (state !== 'idle') {
      for (var i = 0; i < ghosts.length; i++) drawGhost(ghosts[i]);
      var mouth = 0.25 + 0.2 * Math.sin(anim * 14);
      drawPac(OX + pac.x * T + T / 2, OY + pac.y * T + T / 2, T / 2 - 1, pac.dir || {x:1, y:0}, Math.max(0.04, mouth));
    }
    // lives
    for (var l = 0; l < (state === 'idle' ? 0 : lives); l++) {
      drawPac(16 + l * 20, 466, 7, {x:1, y:0}, 0.3);
    }
    ctx.fillStyle = '#888'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
    ctx.fillText('Flèches pour diriger', 352, 470);

    ctx.textAlign = 'center';
    if (state === 'play' && freezeT > 0) {
      ctx.fillStyle = '#ff0'; ctx.shadowColor = '#ff0'; ctx.shadowBlur = 10; ctx.font = 'bold 14px monospace';
      ctx.fillText(freezeMsg, 180, OY + 11.5 * T + 5);
      ctx.shadowBlur = 0;
    }
    if (state === 'idle') {
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(40, 180, 280, 140);
      ctx.strokeStyle = '#ff0'; ctx.strokeRect(40.5, 180.5, 279, 139);
      ctx.fillStyle = '#ff0'; ctx.shadowColor = '#ff0'; ctx.shadowBlur = 14; ctx.font = 'bold 22px monospace';
      ctx.fillText('PAC-MAN', 180, 222);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff0'; ctx.font = 'bold 12px monospace';
      ctx.fillText('Appuyez sur une touche', 180, 258);
      ctx.fillStyle = '#888'; ctx.font = '10px monospace';
      ctx.fillText('Mangez tout, fuyez les fantômes', 180, 288);
    } else if (state === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(40, 180, 280, 140);
      ctx.strokeStyle = '#f33'; ctx.strokeRect(40.5, 180.5, 279, 139);
      ctx.fillStyle = '#f33'; ctx.shadowColor = '#f33'; ctx.shadowBlur = 14; ctx.font = 'bold 20px monospace';
      ctx.fillText('GAME OVER', 180, 222);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px monospace';
      ctx.fillText('Score final : ' + score, 180, 252);
      ctx.fillStyle = '#ff0'; ctx.font = '11px monospace';
      ctx.fillText('Entrée pour rejouer', 180, 282);
    }
  }

  var last = performance.now();
  function frame(now){
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state === 'play') update(dt);
    else anim += dt;
    draw();
    requestAnimationFrame(frame);
  }

  state = 'idle'; score = 0; level = 1; lives = 3; anim = 0; freezeT = 0;
  buildPellets();
  window.focus();
  parent.postMessage({type:'arcade:ready'}, '*');
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;
