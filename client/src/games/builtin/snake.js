// Snake — borne d'arcade intégrée
export default String.raw`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>SNAKE</title>
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
  var COLS = 24, ROWS = 32, CELL = 15;
  // playfield rows 4..31 are visible grid area? We keep full grid 24x32 but draw HUD on top overlay band.
  var snake, dir, dirQueue, food, score, foods, stepMs, acc, state, scoreSent;

  function sendProgress(){ parent.postMessage({type:'arcade:progress', score: score}, '*'); }

  function placeFood(){
    var free = [];
    var occ = {};
    for (var i = 0; i < snake.length; i++) occ[snake[i].x + ',' + snake[i].y] = true;
    for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) {
      if (!occ[x + ',' + y]) free.push({x:x, y:y});
    }
    if (free.length === 0) { food = null; return; }
    food = free[Math.floor(Math.random() * free.length)];
  }

  function reset(){
    snake = [{x:11, y:16}, {x:10, y:16}, {x:9, y:16}];
    dir = {x:1, y:0};
    dirQueue = [];
    score = 0; foods = 0; stepMs = 140; acc = 0; scoreSent = false;
    state = 'play';
    sendProgress();
    placeFood();
  }

  function doGameOver(){
    state = 'over';
    if (!scoreSent) { scoreSent = true; parent.postMessage({type:'arcade:score', score: score}, '*'); }
  }

  function queueDir(nx, ny){
    var lastD = dirQueue.length > 0 ? dirQueue[dirQueue.length - 1] : dir;
    if (lastD.x === nx && lastD.y === ny) return;        // same direction
    if (lastD.x === -nx && lastD.y === -ny) return;      // 180 degrees, ignored
    if (dirQueue.length < 3) dirQueue.push({x:nx, y:ny});
  }

  function step(){
    if (dirQueue.length > 0) dir = dirQueue.shift();
    var head = snake[0];
    var nx = head.x + dir.x, ny = head.y + dir.y;
    // walls kill
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) { doGameOver(); return; }
    var ate = food && nx === food.x && ny === food.y;
    // self collision (tail cell vacates this tick unless we grow)
    var checkLen = ate ? snake.length : snake.length - 1;
    for (var i = 0; i < checkLen; i++) {
      if (snake[i].x === nx && snake[i].y === ny) { doGameOver(); return; }
    }
    snake.unshift({x:nx, y:ny});
    if (ate) {
      score += 10; sendProgress();
      foods++;
      if (foods % 5 === 0) stepMs = Math.max(55, stepMs - 9);
      placeFood();
    } else {
      snake.pop();
    }
  }

  window.addEventListener('keydown', function(e){
    var code = e.code;
    if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'Space') e.preventDefault();
    if (state === 'idle') { reset(); return; }
    if (state === 'over') { if (code === 'Enter') reset(); return; }
    if (code === 'ArrowLeft') queueDir(-1, 0);
    else if (code === 'ArrowRight') queueDir(1, 0);
    else if (code === 'ArrowUp') queueDir(0, -1);
    else if (code === 'ArrowDown') queueDir(0, 1);
  });
  window.addEventListener('keyup', function(){});

  function draw(){
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 360, 480);

    // subtle grid
    ctx.strokeStyle = 'rgba(0,255,120,0.06)'; ctx.lineWidth = 1;
    for (var gx = 1; gx < COLS; gx++) { ctx.beginPath(); ctx.moveTo(gx * CELL, 0); ctx.lineTo(gx * CELL, 480); ctx.stroke(); }
    for (var gy = 1; gy < ROWS; gy++) { ctx.beginPath(); ctx.moveTo(0, gy * CELL); ctx.lineTo(360, gy * CELL); ctx.stroke(); }

    // border (walls)
    ctx.strokeStyle = '#0f6'; ctx.lineWidth = 3;
    ctx.shadowColor = '#0f6'; ctx.shadowBlur = 10;
    ctx.strokeRect(1.5, 1.5, 357, 477);
    ctx.shadowBlur = 0;

    if (food) {
      ctx.shadowColor = '#f0f'; ctx.shadowBlur = 12; ctx.fillStyle = '#f0f';
      ctx.beginPath();
      ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL / 2 - 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    if (snake) {
      for (var i = snake.length - 1; i >= 0; i--) {
        var s = snake[i];
        var col = i === 0 ? '#aaffaa' : '#00ff66';
        ctx.shadowColor = '#0f6'; ctx.shadowBlur = i === 0 ? 12 : 6;
        ctx.fillStyle = col;
        ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
        ctx.shadowBlur = 0;
      }
      // eyes on head
      var h = snake[0];
      ctx.fillStyle = '#000';
      var ex = h.x * CELL + CELL / 2 + dir.x * 3, ey = h.y * CELL + CELL / 2 + dir.y * 3;
      ctx.fillRect(ex - (dir.y !== 0 ? 4 : 1.5), ey - (dir.x !== 0 ? 4 : 1.5), 3, 3);
      ctx.fillRect(ex + (dir.y !== 0 ? 1 : -1.5), ey + (dir.x !== 0 ? 1 : -1.5), 3, 3);
    }

    // HUD
    ctx.textAlign = 'left'; ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#0f6'; ctx.shadowColor = '#0f6'; ctx.shadowBlur = 8;
    ctx.fillText('SNAKE', 10, 20);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
    ctx.fillText('SCORE ' + score, 350, 20);

    ctx.textAlign = 'center';
    if (state === 'idle') {
      overlay();
      ctx.fillStyle = '#0f6'; ctx.shadowColor = '#0f6'; ctx.shadowBlur = 14; ctx.font = 'bold 26px monospace';
      ctx.fillText('S N A K E', 180, 200);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff0'; ctx.font = 'bold 13px monospace';
      ctx.fillText('Appuyez sur une touche', 180, 250);
      ctx.fillStyle = '#888'; ctx.font = '11px monospace';
      ctx.fillText('Flèches pour diriger', 180, 285);
      ctx.fillText('Mangez, grandissez, survivez', 180, 302);
    } else if (state === 'over') {
      overlay();
      ctx.fillStyle = '#f33'; ctx.shadowColor = '#f33'; ctx.shadowBlur = 14; ctx.font = 'bold 24px monospace';
      ctx.fillText('GAME OVER', 180, 210);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px monospace';
      ctx.fillText('Score final : ' + score, 180, 245);
      ctx.fillStyle = '#ff0'; ctx.font = '12px monospace';
      ctx.fillText('Entrée pour rejouer', 180, 275);
    }
  }
  function overlay(){
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(20, 150, 320, 180);
    ctx.strokeStyle = '#0f6'; ctx.lineWidth = 1;
    ctx.strokeRect(20.5, 150.5, 319, 179);
  }

  // fixed timestep loop
  var last = performance.now();
  function frame(now){
    var dt = Math.min(120, now - last); last = now;
    if (state === 'play') {
      acc += dt;
      while (acc >= stepMs && state === 'play') { acc -= stepMs; step(); }
    }
    draw();
    requestAnimationFrame(frame);
  }

  state = 'idle'; score = 0;
  window.focus();
  parent.postMessage({type:'arcade:ready'}, '*');
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;
