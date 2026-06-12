// Breakout — borne d'arcade intégrée
export default String.raw`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>BREAKOUT</title>
<style>
  html, body { margin:0; padding:0; width:100%; height:100%; background:#000; overflow:hidden; }
  body { display:flex; align-items:center; justify-content:center; }
  canvas { max-width:100%; max-height:100%; background:#000; cursor:none; }
</style>
</head>
<body>
<canvas id="cv" width="360" height="480"></canvas>
<script>
(function(){
  'use strict';
  var cv = document.getElementById('cv');
  var ctx = cv.getContext('2d');
  var W = 360, H = 480;
  var BRICK_ROWS = 8, BRICK_COLS = 10;
  var BW = 32, BH = 13, BPAD = 3, BTOP = 64, BLEFT = (W - BRICK_COLS * (BW + BPAD) + BPAD) / 2;
  var ROW_COLORS = ['#ff2050','#ff7020','#ffd020','#40ff40','#20e0e0','#3070ff','#a040ff','#ff40d0'];
  var PADDLE_W = 60, PADDLE_H = 10, PADDLE_Y = H - 36, BALL_R = 5;

  var bricks, bricksLeft, paddleX, ball, score, lives, level, state, scoreSent;
  var keys = { left:false, right:false };
  var baseSpeed, speedTimer;

  function sendProgress(){ parent.postMessage({type:'arcade:progress', score: score}, '*'); }

  function buildBricks(){
    bricks = []; bricksLeft = 0;
    for (var r = 0; r < BRICK_ROWS; r++) {
      bricks[r] = [];
      for (var c = 0; c < BRICK_COLS; c++) { bricks[r][c] = 1; bricksLeft++; }
    }
  }
  function rowPoints(r){ return (BRICK_ROWS - r) * 10; } // top row 80 ... bottom row 10

  function resetBall(){
    ball = { x: paddleX + PADDLE_W / 2, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, stuck: true, speed: baseSpeed };
    speedTimer = 0;
  }
  function launch(){
    if (!ball.stuck) return;
    ball.stuck = false;
    var a = -Math.PI / 2 + (Math.random() * 0.6 - 0.3);
    ball.vx = Math.cos(a) * ball.speed;
    ball.vy = Math.sin(a) * ball.speed;
  }
  function startLevel(){
    buildBricks();
    paddleX = (W - PADDLE_W) / 2;
    resetBall();
  }
  function reset(){
    score = 0; lives = 3; level = 1; scoreSent = false;
    baseSpeed = 230;
    state = 'play';
    sendProgress();
    startLevel();
  }
  function doGameOver(){
    state = 'over';
    if (!scoreSent) { scoreSent = true; parent.postMessage({type:'arcade:score', score: score}, '*'); }
  }

  window.addEventListener('keydown', function(e){
    var code = e.code;
    if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'Space') e.preventDefault();
    if (state === 'idle') { reset(); return; }
    if (state === 'over') { if (code === 'Enter') reset(); return; }
    if (code === 'ArrowLeft') keys.left = true;
    else if (code === 'ArrowRight') keys.right = true;
    else if (code === 'Space') launch();
  });
  window.addEventListener('keyup', function(e){
    if (e.code === 'ArrowLeft') keys.left = false;
    else if (e.code === 'ArrowRight') keys.right = false;
  });
  cv.addEventListener('mousemove', function(e){
    if (state !== 'play') return;
    var rect = cv.getBoundingClientRect();
    var mx = (e.clientX - rect.left) * (W / rect.width);
    paddleX = Math.max(0, Math.min(W - PADDLE_W, mx - PADDLE_W / 2));
  });
  cv.addEventListener('mousedown', function(){ if (state === 'play') launch(); });

  function bounceOffPaddle(){
    var rel = (ball.x - (paddleX + PADDLE_W / 2)) / (PADDLE_W / 2); // -1 .. 1
    rel = Math.max(-1, Math.min(1, rel));
    var angle = rel * (Math.PI / 3) - Math.PI / 2; // up to 60 degrees from vertical
    ball.vx = Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
  }

  function hitBricks(){
    var c = Math.floor((ball.x - BLEFT) / (BW + BPAD));
    var r = Math.floor((ball.y - BTOP) / (BH + BPAD));
    // check a small neighborhood to handle corner hits cleanly
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      var rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= BRICK_ROWS || cc < 0 || cc >= BRICK_COLS) continue;
      if (!bricks[rr][cc]) continue;
      var bx = BLEFT + cc * (BW + BPAD), by = BTOP + rr * (BH + BPAD);
      var nx = Math.max(bx, Math.min(bx + BW, ball.x));
      var ny = Math.max(by, Math.min(by + BH, ball.y));
      var dx = ball.x - nx, dy = ball.y - ny;
      if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
      // brick destroyed
      bricks[rr][cc] = 0; bricksLeft--;
      score += rowPoints(rr); sendProgress();
      // reflect on dominant axis of penetration
      var overlapX = BALL_R - Math.abs(dx), overlapY = BALL_R - Math.abs(dy);
      if (Math.abs(dx) > Math.abs(dy)) {
        ball.vx = -ball.vx;
        ball.x += (dx >= 0 ? overlapX : -overlapX);
      } else if (Math.abs(dy) > Math.abs(dx)) {
        ball.vy = -ball.vy;
        ball.y += (dy >= 0 ? overlapY : -overlapY);
      } else { // exact corner
        ball.vx = -ball.vx; ball.vy = -ball.vy;
      }
      ball.speed = Math.min(480, ball.speed * 1.01);
      renormalize();
      if (bricksLeft === 0) {
        level++;
        baseSpeed = Math.min(420, baseSpeed + 25);
        startLevel();
      }
      return; // one brick per frame keeps physics stable
    }
  }
  function renormalize(){
    var m = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (m > 0) { ball.vx = ball.vx / m * ball.speed; ball.vy = ball.vy / m * ball.speed; }
  }

  function update(dt){
    var pv = 320 * dt;
    if (keys.left) paddleX -= pv;
    if (keys.right) paddleX += pv;
    paddleX = Math.max(0, Math.min(W - PADDLE_W, paddleX));

    if (ball.stuck) {
      ball.x = paddleX + PADDLE_W / 2;
      ball.y = PADDLE_Y - BALL_R - 1;
      return;
    }
    // gradual speed-up over time
    speedTimer += dt;
    if (speedTimer >= 8) {
      speedTimer = 0;
      ball.speed = Math.min(480, ball.speed * 1.06);
      renormalize();
    }
    // sub-steps so the ball never tunnels through bricks/paddle
    var steps = Math.max(1, Math.ceil(ball.speed * dt / 4));
    for (var i = 0; i < steps; i++) {
      ball.x += ball.vx * dt / steps;
      ball.y += ball.vy * dt / steps;
      // walls
      if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
      else if (ball.x > W - BALL_R) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx); }
      if (ball.y < 30 + BALL_R) { ball.y = 30 + BALL_R; ball.vy = Math.abs(ball.vy); }
      // paddle
      if (ball.vy > 0 && ball.y + BALL_R >= PADDLE_Y && ball.y + BALL_R <= PADDLE_Y + PADDLE_H + 6 &&
          ball.x >= paddleX - BALL_R && ball.x <= paddleX + PADDLE_W + BALL_R) {
        ball.y = PADDLE_Y - BALL_R;
        bounceOffPaddle();
      }
      // bricks
      hitBricks();
      // lost
      if (ball.y > H + BALL_R) {
        lives--;
        if (lives <= 0) { doGameOver(); return; }
        resetBall();
        return;
      }
    }
  }

  function draw(){
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    // top bar
    ctx.font = 'bold 14px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = '#0ff'; ctx.shadowColor = '#0ff'; ctx.shadowBlur = 8;
    ctx.fillText('BREAKOUT', 10, 20);
    ctx.shadowBlur = 0;
    ctx.textAlign = 'right'; ctx.fillStyle = '#fff';
    ctx.fillText('SCORE ' + (score || 0), 350, 20);
    ctx.textAlign = 'left'; ctx.fillStyle = '#f0f'; ctx.font = '11px monospace';
    ctx.fillText('NIV ' + (level || 1), 10, 40);
    // lives
    for (var l = 0; l < (lives || 0); l++) {
      ctx.shadowColor = '#0ff'; ctx.shadowBlur = 6; ctx.fillStyle = '#0ff';
      ctx.fillRect(310 - l * 16, 32, 12, 4);
      ctx.shadowBlur = 0;
    }
    ctx.strokeStyle = 'rgba(0,255,255,0.4)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(W, 30); ctx.stroke();

    if (bricks) {
      for (var r = 0; r < BRICK_ROWS; r++) for (var c = 0; c < BRICK_COLS; c++) {
        if (!bricks[r][c]) continue;
        var col = ROW_COLORS[r];
        ctx.shadowColor = col; ctx.shadowBlur = 7; ctx.fillStyle = col;
        ctx.fillRect(BLEFT + c * (BW + BPAD), BTOP + r * (BH + BPAD), BW, BH);
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(BLEFT + c * (BW + BPAD), BTOP + r * (BH + BPAD), BW, 3);
      }
    }
    if (state === 'play' || state === 'over') {
      // paddle
      ctx.shadowColor = '#0ff'; ctx.shadowBlur = 12; ctx.fillStyle = '#0ff';
      ctx.fillRect(paddleX, PADDLE_Y, PADDLE_W, PADDLE_H);
      ctx.shadowBlur = 0;
      // ball
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 12; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (state === 'play' && ball.stuck) {
        ctx.fillStyle = '#ff0'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
        ctx.fillText('ESPACE pour lancer', W / 2, PADDLE_Y - 30);
      }
    }

    ctx.textAlign = 'center';
    if (state === 'idle') {
      panel();
      ctx.fillStyle = '#0ff'; ctx.shadowColor = '#0ff'; ctx.shadowBlur = 14; ctx.font = 'bold 24px monospace';
      ctx.fillText('BREAKOUT', W / 2, 220);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff0'; ctx.font = 'bold 13px monospace';
      ctx.fillText('Appuyez sur une touche', W / 2, 260);
      ctx.fillStyle = '#888'; ctx.font = '11px monospace';
      ctx.fillText('Flèches / souris : raquette', W / 2, 292);
      ctx.fillText('Espace : lancer la balle', W / 2, 308);
    } else if (state === 'over') {
      panel();
      ctx.fillStyle = '#f33'; ctx.shadowColor = '#f33'; ctx.shadowBlur = 14; ctx.font = 'bold 22px monospace';
      ctx.fillText('GAME OVER', W / 2, 225);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 13px monospace';
      ctx.fillText('Score final : ' + score, W / 2, 258);
      ctx.fillStyle = '#ff0'; ctx.font = '12px monospace';
      ctx.fillText('Entrée pour rejouer', W / 2, 290);
    }
  }
  function panel(){
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(30, 180, 300, 150);
    ctx.strokeStyle = '#0ff'; ctx.lineWidth = 1; ctx.strokeRect(30.5, 180.5, 299, 149);
  }

  var last = performance.now();
  function frame(now){
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state === 'play') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  state = 'idle'; score = 0; level = 1; lives = 0;
  paddleX = (W - PADDLE_W) / 2;
  ball = { x: W / 2, y: PADDLE_Y - BALL_R - 1, vx:0, vy:0, stuck:true, speed:0 };
  window.focus();
  parent.postMessage({type:'arcade:ready'}, '*');
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;
