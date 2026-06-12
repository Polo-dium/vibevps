// Tetris — borne d'arcade intégrée
export default String.raw`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>TETRIS</title>
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
  var COLS = 10, ROWS = 20, CELL = 21;
  var BX = 18, BY = 44; // board origin

  var SHAPES = {
    I: { c:'#00f0f0', m:[[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]] },
    J: { c:'#3060ff', m:[[1,0,0],[1,1,1],[0,0,0]] },
    L: { c:'#ff9000', m:[[0,0,1],[1,1,1],[0,0,0]] },
    O: { c:'#f0f000', m:[[1,1],[1,1]] },
    S: { c:'#00e060', m:[[0,1,1],[1,1,0],[0,0,0]] },
    T: { c:'#c040f0', m:[[0,1,0],[1,1,1],[0,0,0]] },
    Z: { c:'#ff3050', m:[[1,1,0],[0,1,1],[0,0,0]] }
  };
  var NAMES = ['I','J','L','O','S','T','Z'];

  var grid, piece, nextName, bag, score, lines, level, state, dropAcc, dropMs, softDown, scoreSent;

  function sendProgress(){ parent.postMessage({type:'arcade:progress', score: score}, '*'); }
  function addScore(n){ if(n<=0) return; score += n; sendProgress(); }

  function newBag(){
    var b = NAMES.slice();
    for (var i = b.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = b[i]; b[i] = b[j]; b[j] = t;
    }
    return b;
  }
  function takeName(){ if (bag.length === 0) bag = newBag(); return bag.pop(); }

  function copyMat(m){ return m.map(function(r){ return r.slice(); }); }
  function rotMat(m){
    var n = m.length, r = [];
    for (var y = 0; y < n; y++) { r[y] = []; for (var x = 0; x < n; x++) r[y][x] = m[n-1-x][y]; }
    return r;
  }
  function collide(m, px, py){
    for (var y = 0; y < m.length; y++) for (var x = 0; x < m.length; x++) {
      if (!m[y][x]) continue;
      var gx = px + x, gy = py + y;
      if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
      if (gy >= 0 && grid[gy][gx]) return true;
    }
    return false;
  }
  function spawn(){
    var name = nextName; nextName = takeName();
    var s = SHAPES[name];
    piece = { name:name, c:s.c, m:copyMat(s.m), x: Math.floor((COLS - s.m.length) / 2), y: (name === 'I' ? -1 : 0) };
    if (collide(piece.m, piece.x, piece.y)) doGameOver();
  }
  function doGameOver(){
    state = 'over';
    if (!scoreSent) { scoreSent = true; parent.postMessage({type:'arcade:score', score: score}, '*'); }
  }
  function reset(){
    grid = []; for (var y = 0; y < ROWS; y++) { grid[y] = []; for (var x = 0; x < COLS; x++) grid[y][x] = 0; }
    bag = newBag(); nextName = takeName();
    score = 0; lines = 0; level = 1; dropAcc = 0; softDown = false; scoreSent = false;
    dropMs = 750; state = 'play';
    sendProgress();
    spawn();
  }
  function lock(){
    for (var y = 0; y < piece.m.length; y++) for (var x = 0; x < piece.m.length; x++) {
      if (piece.m[y][x] && piece.y + y >= 0) grid[piece.y + y][piece.x + x] = piece.c;
    }
    var cleared = 0;
    for (var r = ROWS - 1; r >= 0; r--) {
      var full = true;
      for (var c = 0; c < COLS; c++) if (!grid[r][c]) { full = false; break; }
      if (full) {
        grid.splice(r, 1);
        var row = []; for (var c2 = 0; c2 < COLS; c2++) row.push(0);
        grid.unshift(row);
        cleared++; r++;
      }
    }
    if (cleared > 0) {
      addScore([0,100,300,500,800][cleared] * level);
      lines += cleared;
      var nl = Math.floor(lines / 10) + 1;
      if (nl > level) { level = nl; dropMs = Math.max(80, 750 - (level - 1) * 65); }
    }
    spawn();
  }
  function move(dx){
    if (!collide(piece.m, piece.x + dx, piece.y)) piece.x += dx;
  }
  function rotate(){
    var rm = rotMat(piece.m);
    var kicks = [0, -1, 1, -2, 2];
    for (var i = 0; i < kicks.length; i++) {
      if (!collide(rm, piece.x + kicks[i], piece.y)) { piece.m = rm; piece.x += kicks[i]; return; }
    }
  }
  function stepDown(){
    if (!collide(piece.m, piece.x, piece.y + 1)) { piece.y++; return true; }
    lock(); return false;
  }
  function hardDrop(){
    var d = 0;
    while (!collide(piece.m, piece.x, piece.y + 1)) { piece.y++; d++; }
    if (d > 0) addScore(d * 2);
    lock(); dropAcc = 0;
  }

  // ---- input ----
  window.addEventListener('keydown', function(e){
    var code = e.code;
    if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'Space') e.preventDefault();
    if (state === 'idle') { reset(); return; }
    if (state === 'over') { if (code === 'Enter') reset(); return; }
    if (code === 'ArrowLeft') move(-1);
    else if (code === 'ArrowRight') move(1);
    else if (code === 'ArrowUp') rotate();
    else if (code === 'ArrowDown') softDown = true;
    else if (code === 'Space') hardDrop();
  });
  window.addEventListener('keyup', function(e){
    if (e.code === 'ArrowDown') softDown = false;
  });

  // ---- render ----
  function cell(x, y, c){
    ctx.shadowColor = c; ctx.shadowBlur = 8;
    ctx.fillStyle = c;
    ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + 1, y + 1, CELL - 2, 4);
  }
  function draw(){
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 360, 480);
    ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = '#0ff'; ctx.shadowColor = '#0ff'; ctx.shadowBlur = 12;
    ctx.fillText('T E T R I S', 180, 26);
    ctx.shadowBlur = 0;

    // board frame
    ctx.strokeStyle = '#0ff'; ctx.lineWidth = 2;
    ctx.shadowColor = '#0ff'; ctx.shadowBlur = 6;
    ctx.strokeRect(BX - 2, BY - 2, COLS * CELL + 4, ROWS * CELL + 4);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,255,255,0.08)'; ctx.lineWidth = 1;
    for (var gx = 1; gx < COLS; gx++) { ctx.beginPath(); ctx.moveTo(BX + gx * CELL, BY); ctx.lineTo(BX + gx * CELL, BY + ROWS * CELL); ctx.stroke(); }
    for (var gy = 1; gy < ROWS; gy++) { ctx.beginPath(); ctx.moveTo(BX, BY + gy * CELL); ctx.lineTo(BX + COLS * CELL, BY + gy * CELL); ctx.stroke(); }

    if (grid) for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) {
      if (grid[y][x]) cell(BX + x * CELL, BY + y * CELL, grid[y][x]);
    }
    if (state === 'play' && piece) {
      // ghost piece
      var gy2 = piece.y;
      while (!collide(piece.m, piece.x, gy2 + 1)) gy2++;
      ctx.globalAlpha = 0.2;
      for (var py = 0; py < piece.m.length; py++) for (var px = 0; px < piece.m.length; px++) {
        if (piece.m[py][px] && gy2 + py >= 0) cell(BX + (piece.x + px) * CELL, BY + (gy2 + py) * CELL, piece.c);
      }
      ctx.globalAlpha = 1;
      for (var py2 = 0; py2 < piece.m.length; py2++) for (var px2 = 0; px2 < piece.m.length; px2++) {
        if (piece.m[py2][px2] && piece.y + py2 >= 0) cell(BX + (piece.x + px2) * CELL, BY + (piece.y + py2) * CELL, piece.c);
      }
    }

    // side panel
    ctx.textAlign = 'left'; ctx.font = '12px monospace'; ctx.fillStyle = '#0f0';
    ctx.fillText('SCORE', 248, 70);
    ctx.font = 'bold 14px monospace'; ctx.fillStyle = '#fff';
    ctx.fillText(String(score === undefined ? 0 : score), 248, 88);
    ctx.font = '12px monospace'; ctx.fillStyle = '#0f0';
    ctx.fillText('NIVEAU ' + (level || 1), 248, 112);
    ctx.fillText('LIGNES ' + (lines || 0), 248, 130);
    ctx.fillText('SUIVANT', 248, 160);
    ctx.strokeStyle = '#f0f'; ctx.lineWidth = 1;
    ctx.shadowColor = '#f0f'; ctx.shadowBlur = 5;
    ctx.strokeRect(248, 168, 84, 84);
    ctx.shadowBlur = 0;
    if (nextName) {
      var ns = SHAPES[nextName], nm = ns.m, sz = 16;
      var w = nm.length * sz;
      var ox = 248 + (84 - w) / 2, oy = 168 + (84 - w) / 2;
      for (var ny = 0; ny < nm.length; ny++) for (var nx = 0; nx < nm.length; nx++) {
        if (nm[ny][nx]) {
          ctx.shadowColor = ns.c; ctx.shadowBlur = 6; ctx.fillStyle = ns.c;
          ctx.fillRect(ox + nx * sz + 1, oy + ny * sz + 1, sz - 2, sz - 2);
          ctx.shadowBlur = 0;
        }
      }
    }
    ctx.fillStyle = '#888'; ctx.font = '9px monospace';
    ctx.fillText('FLECHES bouger', 244, 290);
    ctx.fillText('HAUT tourner', 244, 304);
    ctx.fillText('BAS descendre', 244, 318);
    ctx.fillText('ESPACE chute', 244, 332);

    ctx.textAlign = 'center';
    if (state === 'idle') {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(BX, BY + 160, COLS * CELL, 60);
      ctx.fillStyle = '#ff0'; ctx.shadowColor = '#ff0'; ctx.shadowBlur = 10; ctx.font = 'bold 13px monospace';
      ctx.fillText('Appuyez sur une touche', BX + COLS * CELL / 2, BY + 195);
      ctx.shadowBlur = 0;
    } else if (state === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(BX, BY + 140, COLS * CELL, 100);
      ctx.fillStyle = '#f33'; ctx.shadowColor = '#f33'; ctx.shadowBlur = 12; ctx.font = 'bold 18px monospace';
      ctx.fillText('GAME OVER', BX + COLS * CELL / 2, BY + 180);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.font = '11px monospace';
      ctx.fillText('Entrée pour rejouer', BX + COLS * CELL / 2, BY + 210);
    }
  }

  // ---- main loop (fixed timestep gravity) ----
  var last = performance.now();
  function frame(now){
    var dt = Math.min(100, now - last); last = now;
    if (state === 'play') {
      dropAcc += dt;
      var interval = softDown ? Math.min(40, dropMs) : dropMs;
      while (dropAcc >= interval && state === 'play') {
        dropAcc -= interval;
        if (softDown) addScore(1);
        stepDown();
      }
    }
    draw();
    requestAnimationFrame(frame);
  }

  state = 'idle'; score = 0; level = 1; lines = 0;
  window.focus();
  parent.postMessage({type:'arcade:ready'}, '*');
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;
