/* =====================================================================
   RING REMADE
   A from-scratch re-implementation of the rotating "ring" carousel used
   on demo.filatov.design/offline — same geometry, same spring physics,
   same interaction vocabulary, but written to be read.

   ---------------------------------------------------------------------
   THE SHORT VERSION OF HOW THE EFFECT WORKS
   ---------------------------------------------------------------------
   It is NOT CSS 3D and there is no rotate3d() anywhere.

   Every look is a flat billboard standing on a CIRCLE that is viewed in
   PERSPECTIVE. The circle lives in 3D (angle a, radius R, depth z) and
   the camera projects it to the screen:

       z      = R * (1 - cos a)          <- how far "behind" the item is
       depth  = P / (P + z)              <- perspective divide (P = camera dist)
       scale  = depth * (1 + (F-1)*focus)  <- F = extra pop for the item in focus
       x      = cx + R * sin(a) * depth
       y      = horizon + (floor - horizon) * depth

   Because the perspective divide also shrinks R*sin(a), the items hug
   the centre line instead of sliding off sideways — that is what makes
   it read as a ring rather than a flat strip.

   Rotation is a single float `cur` (in "item units"). Item i sits at
   angle (i - cur) * 2PI/N. A critically damped spring chases the
   target angle, so every input (drag, wheel, key, autoplay) goes
   through the same smoothing and the whole thing feels like one
   physical object.
   ===================================================================== */
(() => {
'use strict';

/* ---------------------------------------------------------------- utils */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mod   = (n, m) => ((n % m) + m) % m;
const pad   = (n) => String(n).padStart(2, '0');
/* shortest signed angle in (-PI, PI] */
const wrap  = (a) => { a = mod(a, TAU); if (a > Math.PI) a -= TAU; if (a <= -Math.PI) a += TAU; return a; };
const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0);

/* ------------------------------------------------------------- tuning */
const CFG = {
  radius:    0.44,   // ring radius  = fraction of stage width (desktop)
  radiusMob: 0.84,   // mobile ring is wider -> you see more of the circle
  persp:     0.80,   // camera distance (fraction of width). smaller = flatter
  perspMob:  1.10,
  horizon:   0.06,   // vertical anchor of the far side of the ring
  fit:       1.12,   // model height vs. available stage height
  front:     1.165,  // extra scale applied to the item in focus
  frontMob:  1.12,
  step:      0.03,   // how far the focused item is pushed down (desktop)
  lift:      40,     // px the ring floats above the floor line
  spring:    95,     // spring stiffness  (see step())
  dragSpeed: 0.30,   // fraction of the stage width that equals one step
  autoplayMs:5000,
  maxBlur:   6.5,
};

/* ---------------------------------------------------------------- data */
/* 9 looks. `pal` drives the generated artwork, `pins` are the % positions
   of the shoppable hotspots on the model, `foot` nudges the artwork so
   the feet land exactly on the ground line. */
const LOOKS = [
  { name:'Do Not Disturb', foot:.040, pal:{skin:'#e6b995',hair:'#2b2320',top:'#7d8a6b',bottom:'#2c2c30',shoe:'#1b1b1e',garment:'tee'},
    pins:[[74,32],[30,47],[50,57]],
    pieces:[{name:'Washed Boxy Tee',kind:'Top',price:44},{name:'Ringer Long Sleeve',kind:'Top',price:38},{name:'Studded Belt',kind:'Accessory',price:34}] },

  { name:'Shuffle', foot:.095, pal:{skin:'#d9a97e',hair:'#3a2b22',top:'#2f3a4d',bottom:'#5a5f66',shoe:'#e8e8ea',garment:'jacket'},
    pins:[[80,35],[41,67],[38,85]],
    pieces:[{name:'Nylon Harrington',kind:'Outerwear',price:138},{name:'Track Trousers',kind:'Bottom',price:88},{name:'Silver Runners',kind:'Shoes',price:132}] },

  { name:'Repeat One', foot:.050, pal:{skin:'#c98f63',hair:'#17110e',top:'#e6dfd0',bottom:'#8fa3bb',shoe:'#c9a67c',garment:'cardigan'},
    pins:[[80,38],[27,74],[72,91]],
    pieces:[{name:'Brushed Cardigan',kind:'Top',price:96},{name:'Faded Baggy Jeans',kind:'Bottom',price:112},{name:'Trail Runners',kind:'Shoes',price:128}] },

  { name:'Signal Lost', foot:.081, pal:{skin:'#e2b38c',hair:'#4a3524',top:'#2f56c9',bottom:'#9a8a62',shoe:'#c3c7cc',garment:'jacket'},
    pins:[[72,32],[42,62],[20,86]],
    pieces:[{name:'Cobalt Track Jacket',kind:'Outerwear',price:112},{name:'Cargo Trousers',kind:'Bottom',price:98},{name:'Chrome Runners',kind:'Shoes',price:124}] },

  { name:'Off Grid', foot:.050, pal:{skin:'#a9714b',hair:'#241a14',top:'#a85f3c',bottom:'#5b4a37',shoe:'#dedad2',garment:'knit'},
    pins:[[62,32],[45,74],[43,92]],
    pieces:[{name:'Cable Knit Sweater',kind:'Top',price:124},{name:'Utility Cargo',kind:'Bottom',price:102},{name:'Canvas Skate Shoes',kind:'Shoes',price:72}] },

  { name:'Static', foot:.012, pal:{skin:'#efc9a8',hair:'#8a8f96',top:'#9aa1a8',bottom:'#33363c',shoe:'#e3e6ea',garment:'bomber'},
    pins:[[80,38],[72,66],[35,83]],
    pieces:[{name:'Metallic Bomber',kind:'Outerwear',price:164},{name:'Dirty Wash Jeans',kind:'Bottom',price:118},{name:'Mesh Runners',kind:'Shoes',price:126}] },

  { name:'Side A', foot:.091, pal:{skin:'#d8a37c',hair:'#5b3f2c',top:'#b7a9d6',bottom:'#3a3a44',shoe:'#6b4a30',garment:'tee'},
    pins:[[63,32],[29,69],[73,86]],
    pieces:[{name:'Cropped Sweatshirt',kind:'Top',price:68},{name:'Wide Cord Trousers',kind:'Bottom',price:96},{name:'Leather Court Shoes',kind:'Shoes',price:110}] },

  { name:'Airplane Mode', foot:.046, pal:{skin:'#c99165',hair:'#1e1a17',top:'#9fb3a1',bottom:'#b9a887',shoe:'#f0f0f0',garment:'shirt'},
    pins:[[20,34],[37,74],[56,90]],
    pieces:[{name:'Panel Camp Shirt',kind:'Top',price:78},{name:'Parachute Pants',kind:'Bottom',price:92},{name:'White Trainers',kind:'Shoes',price:112}] },

  { name:'Slow Hours', foot:.061, pal:{skin:'#e3b48d',hair:'#2e2622',top:'#7a6249',bottom:'#2f3b4d',shoe:'#b59372',garment:'shirt'},
    pins:[[72,36],[40,66],[40,90]],
    pieces:[{name:'Knit Polo',kind:'Top',price:82},{name:'Pleated Chinos',kind:'Bottom',price:90},{name:'Suede Trainers',kind:'Shoes',price:138}] },
];

/* ------------------------------------------------- generated artwork */
/* No image files: every look is a tiny flat SVG so the demo is one
   folder with no network. Swap `figureSVG()` for real photography. */
function figureSVG(p){
  const {skin, hair, top, bottom, shoe, garment} = p;
  const longSleeve = garment === 'jacket' || garment === 'cardigan' || garment === 'bomber';
  const sleeves = longSleeve
    ? `<path d="M92 94 L74 104 L70 206 L88 208 L92 130 Z" fill="${top}"/>
       <path d="M148 94 L166 104 L170 206 L152 208 L148 130 Z" fill="${top}"/>`
    : `<path d="M92 94 L74 104 L78 152 L94 150 L92 130 Z" fill="${top}"/>
       <path d="M148 94 L166 104 L162 152 L146 150 L148 130 Z" fill="${top}"/>`;

  let extra = '';
  if(garment === 'jacket' || garment === 'bomber'){
    extra = `<path d="M120 84 L136 92 L136 240 L104 240 L104 92 Z" fill="${shade(top,-18)}" opacity=".85"/>
             <path d="M104 92 L120 84 L120 240 L104 240 Z" fill="${shade(top,-34)}" opacity=".9"/>`;
  } else if(garment === 'cardigan' || garment === 'knit'){
    extra = `<path d="M120 84 L138 94 L138 244 L102 244 L102 94 Z" fill="${shade(top,-14)}" opacity=".55"/>`;
  } else if(garment === 'shirt'){
    extra = `<path d="M104 86 L120 106 L136 86 L128 82 L120 94 L112 82 Z" fill="${shade(top,-22)}"/>`;
  }

  const svg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 420" width="240" height="420">
  <ellipse cx="120" cy="404" rx="66" ry="9" fill="#000" opacity=".13"/>
  <path d="M92 236 L120 236 L117 300 L115 374 L95 374 L95 300 Z" fill="${bottom}"/>
  <path d="M120 236 L148 236 L145 300 L143 374 L123 374 L123 300 Z" fill="${shade(bottom,-12)}"/>
  <path d="M93 370 L115 370 L118 388 Q118 394 110 394 L90 394 Q86 394 87 388 Z" fill="${shoe}"/>
  <path d="M147 370 L125 370 L122 388 Q122 394 130 394 L150 394 Q154 394 153 388 Z" fill="${shade(shoe,-14)}"/>
  ${sleeves}
  <path d="M92 92 Q120 80 148 92 L150 118 L150 240 L90 240 L90 118 Z" fill="${top}"/>
  ${extra}
  <path d="M110 68 L130 68 L130 90 L110 90 Z" fill="${shade(skin,-16)}"/>
  <circle cx="120" cy="56" r="21" fill="${skin}"/>
  <path d="M99 54 Q99 32 120 32 Q141 32 141 54 Q138 41 126 40 Q110 39 103 50 Z" fill="${hair}"/>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function shade(hex, amt){
  const n = parseInt(hex.slice(1), 16);
  const c = [(n>>16)&255, (n>>8)&255, n&255].map(v => clamp(v+amt,0,255));
  return '#' + c.map(v => v.toString(16).padStart(2,'0')).join('');
}

/* little garment icon used in the piece rail / pins */
function pieceSVG(kind, color){
  let shape = '';
  if(kind === 'Shoes')      shape = `<path d="M8 26 L26 26 L32 34 Q32 38 27 38 L7 38 Q4 38 5 34 Z" fill="${color}"/><path d="M14 18 L28 18 L32 26 L8 26 Z" fill="${shade(color,-16)}"/>`;
  else if(kind === 'Bottom') shape = `<path d="M12 8 L28 8 L26 38 L18 38 L20 20 L18 38 L12 38 Z" fill="${color}"/>`;
  else if(kind === 'Accessory') shape = `<rect x="6" y="20" width="28" height="7" rx="2" fill="${color}"/><rect x="18" y="18" width="5" height="11" fill="${shade(color,-30)}"/>`;
  else if(kind === 'Outerwear') shape = `<path d="M13 8 L20 12 L20 38 L10 38 L10 12 Z M23 8 L30 12 L30 38 L20 38 L20 12 Z" fill="${color}"/>`;
  else shape = `<path d="M14 8 L20 12 L26 8 L34 12 L32 22 L27 20 L27 36 L13 36 L13 20 L8 22 L6 12 Z" fill="${color}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 44" width="40" height="44">${shape}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/* ------------------------------------------------------------- state */
const $ = (id) => document.getElementById(id);
const rw        = $('rw');
const stage     = $('stage');
const bodiesEl  = $('bodies');
const gridcaps  = $('gridcaps');
const cursorEl  = $('cursor');
const miniEl    = $('mini');
const lbEl      = $('lb');
const lbStage   = $('lbstage');
const idxEl     = $('idx');

const S = {
  W:0, H:0, mobile:false,
  modelH:0, itemW:0, radius:0, persp:0, cx:0, horizonY:0, floorY:0, front:1.165,
  cur:0,          // animated angle, in item units
  target:0,       // desired angle, in item units
  vel:0,          // spring velocity
  index:0,        // selected item
  items:[],
  grid:false,
  playing:false,
  zoomed:false,
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
};

/* ------------------------------------------------------- build DOM */
LOOKS.forEach((look, i) => {
  const el = document.createElement('div');
  el.className = 'rw__body';
  el.style.setProperty('--foot', String(look.foot));
  el.innerHTML =
    `<div class="rw__fig">
       <img class="rw__pic" src="${figureSVG(look.pal)}" alt="${look.name}" draggable="false" decoding="async">
       <button class="rw__hit" type="button" tabindex="-1" data-a="${i}" aria-label="Look ${pad(i+1)}: ${look.name}"></button>
     </div>`;
  bodiesEl.appendChild(el);
  S.items.push({ el, fig: el.querySelector('.rw__fig'), hit: el.querySelector('.rw__hit'), w:0, blur:'', op:'' });

  const cap = document.createElement('span');
  cap.className = 'rw__grid-cap cap';
  cap.style.setProperty('--i', String(i));
  cap.textContent = `${pad(i+1)}  ${look.name}`;
  gridcaps.appendChild(cap);
});

/* --------------------------------------------------------- measuring */
function measure(){
  const r = stage.getBoundingClientRect();
  S.W = r.width || innerWidth;
  S.H = r.height || innerHeight;
  S.mobile = innerWidth < 810;

  const ringGap = S.mobile ? 168 : 120;   // distance from stage floor to ring base
  const horizonBase = 136;

  S.modelH = Math.max(200, Math.round((S.H - ringGap - 18 - horizonBase) / CFG.fit));
  S.itemW  = S.modelH * 4 / 7;
  S.radius = S.W * (S.mobile ? CFG.radiusMob : CFG.radius);
  S.persp  = S.W * (S.mobile ? CFG.perspMob : CFG.persp);
  S.cx     = S.W / 2;
  S.horizonY = horizonBase + (S.H - horizonBase) * CFG.horizon - CFG.lift;
  S.floorY   = S.H - ringGap - CFG.lift;
  S.front    = S.mobile ? CFG.frontMob : CFG.front;

  stage.style.setProperty('--model-h', S.modelH + 'px');
  S.items.forEach(it => { it.w = S.itemW; });
}

/* ============================================================ GEOMETRY */

/* Place one billboard.
   The body is anchored bottom-left of the stage, transform-origin is the
   bottom-centre of the figure box, so:
       tx = x - itemW/2        -> horizontally centred on x
       ty = y - H              -> the ground line of the item lands on y
   (the scale is applied about the bottom-centre, so the figure grows
    upwards out of its own ground line — exactly like the original) */
function place(it, x, groundY, scale, blur, visible){
  const tx = x - it.w / 2;
  const ty = groundY - S.H;
  it.el.style.transform =
    `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`;

  const op = visible ? '1' : '0';
  if(op !== it.op){
    it.op = op;
    it.el.style.opacity = op;
    it.el.style.visibility = visible ? '' : 'hidden';
    it.el.style.pointerEvents = visible ? '' : 'none';
  }
  const b = blur <= 0.05 ? '' : `blur(${blur.toFixed(1)}px)`;
  if(b !== it.blur){ it.blur = b; it.el.style.filter = b; }
  it.el.style.zIndex = String(Math.round(scale * 1000));
}

/* THE RING LAYOUT — the heart of the effect.
   For every item i:
     a     = (i - cur) * 2PI/N          angle of the item on the circle
     z     = R * (1 - cos a)            depth behind the camera plane
     depth = P / (P + z)                perspective divide
     focus = 1 - |a| / (2PI/N)          1 when the item is dead centre
     scale = depth * (1 + (front-1)*focus)
     x     = cx + R * sin(a) * depth
     y     = horizon + (floor - horizon) * depth   (+ step for the focused one)
     blur  = grows with angular distance -> cheap depth of field        */
function layoutRing(){
  const N = LOOKS.length;
  const ang = TAU / N;
  const stepPx = S.mobile ? 0 : S.H * CFG.step;

  for(let i = 0; i < N; i++){
    const it = S.items[i];
    const a     = wrap((i - S.cur) * ang);
    const depth = S.persp / (S.persp + S.radius * (1 - Math.cos(a)));
    const u     = Math.abs(a) / ang;
    const focus = clamp(1 - u, 0, 1);
    const scale = depth * (1 + (S.front - 1) * focus);
    const x     = S.cx + S.radius * Math.sin(a) * depth;
    const y     = S.horizonY + (S.floorY - S.horizonY) * depth + stepPx * focus;
    const blur  = u <= 1 ? 1.8 * u : Math.min(1.8 + (u - 1) * 2, CFG.maxBlur);

    /* cull what is completely off screen (saves a lot of paint) */
    const half = it.w * scale / 2;
    const visible = !(x + half < -4 || x - half > S.W + 4);

    place(it, x, y, scale, blur, visible);
    it.el.classList.toggle('is-focus', i === S.index);
  }
}

/* GRID LAYOUT — the same items re-composed into a 3-column sheet. */
function layoutGrid(){
  const N = LOOKS.length;
  const cols = 3, rows = Math.ceil(N / cols);
  const capH = S.mobile ? 72 : 80;
  const cellH = (S.H - (S.mobile ? 104 : 96) - capH) / rows;
  const colW  = S.W / cols;
  const scale = Math.min(cellH - 40, (colW * 7 / 4) * 0.92) / S.modelH;

  for(let i = 0; i < N; i++){
    const it = S.items[i];
    const col = i % cols, row = Math.floor(i / cols);
    const x = colW * (col + 0.5);
    const top = capH + cellH * (row + 1) - 32;
    place(it, x, top, scale, 0, true);
    it.el.classList.remove('is-focus');
    const cap = gridcaps.children[i];
    /* keep the caption inside the viewport on the first/last columns */
    const half = cap.offsetWidth / 2;
    const cx = clamp(x, half + 4, S.W - half - 4);
    cap.style.transform = `translate3d(${cx.toFixed(1)}px, ${(top + 12).toFixed(1)}px, 0) translateX(-50%)`;
  }
}

/* ============================================================== SPRING */
/* A critically damped spring (c = 2*sqrt(k)) chases the target angle.
   Semi-implicit Euler, 3 substeps per frame, dt clamped to 34 ms so a
   dropped frame can never make it explode. Every input in the UI feeds
   `target`; the spring turns that into motion. That is the whole
   "premium" feel — one oscillator, many inputs. */
function springStep(dt){
  const k = CFG.spring, c = 2 * Math.sqrt(k);
  const h = dt / 3;
  for(let i = 0; i < 3; i++){
    const acc = -k * (S.cur - S.target) - c * S.vel;
    S.vel += acc * h;
    S.cur  += S.vel * h;
  }
  if(Math.abs(S.cur - S.target) <= 5e-4 && Math.abs(S.vel) <= 5e-4){
    S.cur = S.target; S.vel = 0; return false;
  }
  return true;
}

/* a frame that must happen even if the browser is throttling:
   used for the FLIP animation of the lightbox */
const nextFrame = (fn) => { requestAnimationFrame(fn); setTimeout(fn, 60); };

/* =============================================================== LOOP */
/* `lastRaf` tracks the animation clock, `lastStep` the simulation clock.
   They MUST be separate: if the fallback timer updated `lastRaf` it would
   immediately think rAF is alive and stop driving the loop.
   The simulation always reads its own clock (performance.now) — a rAF
   timestamp can be OLDER than the last fallback tick, and a negative dt
   makes the spring oscillate around its target instead of settling. */
let lastRaf = 0, lastStep = 0, dirty = true;

function tick(){
  const now = performance.now();
  let elapsed = lastStep ? (now - lastStep) / 1000 : 1 / 60;
  lastStep = now;
  elapsed = clamp(elapsed, 0, 0.25);   /* never simulate more than 250ms of catch-up */

  let moving = false;
  if(S.reduced){
    if(S.cur !== S.target){ S.cur = S.target; S.vel = 0; moving = true; }
  } else {
    /* Fixed-step catch-up: the animation keeps REAL-TIME pace even when
       frames are dropped, instead of playing in slow motion. Up to 8
       steps of 1/60s (133ms) are replayed per frame; the rest is dropped
       so a long stall (tab in the background) can never explode the
       spring. The original site just clamps dt, so it slows down when
       the frame rate drops — this is the one place worth improving. */
    const steps = clamp(Math.round(elapsed / (1/60)), 1, 8);
    const h = elapsed / steps;
    for(let i = 0; i < steps; i++) moving = springStep(h) || moving;
  }

  if(dirty || moving){ layout(); dirty = false; }
  rw.classList.toggle('is-moving', moving);
}

/* rAF is the right clock, but some embedded/preview WebViews throttle or
   suppress it entirely — which is exactly how you end up with a blank
   stage. So we drive the simulation from rAF and keep a timer-based
   fallback alive for when rAF stops delivering. */
function rafLoop(now){ lastRaf = now; tick(); requestAnimationFrame(rafLoop); }
requestAnimationFrame(rafLoop);
setInterval(() => {
  if(performance.now() - lastRaf > 40) tick();   /* rAF is dead/paused -> keep going */
}, 16);


/* ============================================================== SETUP */
function setIndex(i, silent){
  i = mod(i, LOOKS.length);
  const changed = i !== S.index;
  S.index = i;
  S.items.forEach((it, n) => {
    it.hit.setAttribute('tabindex', n === i ? '0' : '-1');
    it.el.classList.toggle('is-focus', n === i);
  });
  $('nowi').textContent = pad(i + 1);
  $('nown').textContent = LOOKS[i].name;
  renderMini();
  if(changed && !silent) sweep();
}

function sweep(){
  stage.classList.remove('is-sweep');
  void stage.offsetWidth;
  stage.classList.add('is-sweep');
}

/* go to an absolute item index (shortest way round) */
function goTo(i){
  stopAuto();
  const cur = Math.round(S.target);
  let d = mod(i - cur, LOOKS.length);
  if(d > LOOKS.length / 2) d -= LOOKS.length;
  S.target = cur + d;
  setIndex(mod(cur + d, LOOKS.length));
  kick();
}
const next = () => goTo(S.index + 1);
const prev = () => goTo(S.index - 1);

/* the mini piece rail */
function renderMini(){
  const look = LOOKS[S.index];
  miniEl.innerHTML = look.pieces.map((p, i) =>
    `<li><button type="button" data-p="${i+1}" aria-label="${p.name}, ${money(p.price)}">
       <img src="${pieceSVG(p.kind, ['#111','#3a4a6b','#7a6249'][i%3])}" alt="" width="44" height="44">
     </button></li>`).join('');
}
miniEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-p]');
  if(b){ openLightbox(+b.dataset.p); }
});

/* ========================================================== AUTOPLAY */
let autoTimer = null;
function startAuto(){
  S.playing = true;
  $('auto').setAttribute('aria-pressed', 'true');
  rw.classList.add('is-playing');
  scheduleAuto();
}
function stopAuto(){
  if(!S.playing) return;
  S.playing = false;
  $('auto').setAttribute('aria-pressed', 'false');
  rw.classList.remove('is-playing');
  clearTimeout(autoTimer);
}
function scheduleAuto(){
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    if(!S.playing || S.zoomed || S.grid || document.hidden || !inView) return;
    goTo(S.index + 1);
    scheduleAuto();
  }, CFG.autoplayMs);
}
$('auto').addEventListener('click', () => {
  if(S.playing) stopAuto(); else { startAuto(); }
});

/* ========================================================== INTERACTION */
/* DRAG -----------------------------------------------------------------
   1. pointerdown remembers where the gesture started
   2. the first 8px of horizontal movement decides "this is a drag" —
      vertical movement is released back to the page so the layout can
      still scroll on touch devices
   3. while dragging we move the TARGET angle, the spring chases it,
      so the ring lags slightly behind the finger (that lag is the feel)
   4. on release we sample the pointer velocity over the last ~6 events
      and project it 160ms forward to pick the landing item            */
let dragging = false, dragLocked = false, startX = 0, startY = 0, startTarget = 0;
let samples = [], lastRelease = 0;

stage.addEventListener('pointerdown', (e) => {
  if(S.zoomed || S.grid) return;
  if(e.pointerType === 'mouse' && e.button !== 0) return;
  dragging = true; dragLocked = false;
  startX = e.clientX; startY = e.clientY;
  startTarget = S.target;
  samples = [{x:e.clientX, t:e.timeStamp}];
});

stage.addEventListener('pointermove', (e) => {
  updateCursor(e);
  if(!dragging || e.pointerId !== dragId) return;
  if(e.pointerType === 'mouse' && !(e.buttons & 1)){ endDrag(e); return; }

  const dx = e.clientX - startX, dy = e.clientY - startY;

  if(!dragLocked){
    if(Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)){ dragging = false; return; }  /* let it scroll */
    if(Math.abs(dx) > 8 && Math.abs(dx) > 1.2 * Math.abs(dy)){
      dragLocked = true;
      rw.classList.add('is-dragging');
      stage.setPointerCapture(e.pointerId);
      stopAuto();
    } else return;
  }

  samples.push({x:e.clientX, t:e.timeStamp});
  if(samples.length > 6) samples.shift();

  S.target = startTarget - dx / dragStep();
  setIndex(Math.round(S.target));
  dirty = true;
});

stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

function endDrag(e){
  if(!dragging) return;
  dragging = false;
  if(!dragLocked){ lastRelease = e.timeStamp; return; }
  dragLocked = false;
  rw.classList.remove('is-dragging');

  const first = samples[0], last = samples[samples.length - 1];
  const v = (last.t > first.t) ? (last.x - first.x) / (last.t - first.t) : 0;  /* px per ms */
  const dx = e.clientX - startX;
  const anchor = Math.round(startTarget);
  let landing;

  if(S.mobile){
    /* touch: one flick = one step */
    landing = (Math.abs(dx) > 30 || Math.abs(v) > 0.3) ? anchor + (dx < 0 ? 1 : -1) : anchor;
  } else {
    /* mouse/trackpad: project the momentum 160ms forward */
    landing = Math.round(S.target - v * 160 / dragStep());
    if(landing === anchor && Math.abs(v) > 0.3) landing = anchor + (v < 0 ? 1 : -1);
    landing = clamp(landing, anchor - 2, anchor + 2);
  }

  S.target = landing;
  setIndex(mod(landing, LOOKS.length));
  dirty = true;
  lastRelease = e.timeStamp;
}

let dragId = null;
stage.addEventListener('pointerdown', (e) => { dragId = e.pointerId; });

/* how many pixels of travel equal one step */
function dragStep(){
  return Math.max(S.mobile ? 90 : 120, S.W * CFG.dragSpeed);
}

/* WHEEL / TRACKPAD ----------------------------------------------------- */
let wheelAcc = 0, wheelLock = 0;
stage.addEventListener('wheel', (e) => {
  if(Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   /* vertical scroll */
  if(S.zoomed || S.grid) return;
  e.preventDefault();
  if(e.timeStamp < wheelLock) return;
  wheelAcc += e.deltaX;
  if(Math.abs(wheelAcc) > 45){
    stopAuto();
    wheelAcc > 0 ? next() : prev();
    wheelAcc = 0;
    wheelLock = e.timeStamp + 520;
  }
}, {passive:false});

/* KEYBOARD ------------------------------------------------------------- */
stage.addEventListener('keydown', (e) => {
  const step = S.grid ? 3 : 1;
  if(e.key === 'ArrowRight'){ e.preventDefault(); stopAuto(); next(); }
  else if(e.key === 'ArrowLeft'){ e.preventDefault(); stopAuto(); prev(); }
  else if(S.grid && (e.key === 'ArrowDown' || e.key === 'ArrowUp')){
    e.preventDefault(); stopAuto();
    S.target = Math.round(S.target) + (e.key === 'ArrowDown' ? step : -step);
    setIndex(Math.round(S.target));
    dirty = true;
  }
  else if(e.key === 'Enter' && !S.zoomed){ e.preventDefault(); openLightbox(); }
});
addEventListener('keydown', (e) => {
  if(e.key === 'Escape'){ if(S.zoomed) closeLightbox(); else if(rw.classList.contains('is-index')) toggleIndex(false); }
});

/* CLICK -> open the focused look (a short tap, not the end of a drag) */
stage.addEventListener('click', (e) => {
  if(e.timeStamp - lastRelease < 60) return;
  const hit = e.target.closest('.rw__hit');
  if(!hit) return;
  const a = +hit.dataset.a;
  const off = mod(a - Math.round(S.target) + LOOKS.length / 2, LOOKS.length) - LOOKS.length / 2;
  if(off === 0) openLightbox();
  else { stopAuto(); goTo(a); }
});

/* CUSTOM CURSOR (fine pointers only) ----------------------------------- */
let cx = 0, cy = 0, tx = 0, ty = 0, cursorRaf = 0;
if(S.fine) rw.classList.add('has-cursor');
function updateCursor(e){
  if(!S.fine) return;
  const r = stage.getBoundingClientRect();
  tx = e.clientX - r.left; ty = e.clientY - r.top;
  if(!cursorEl.classList.contains('is-on')){ cx = tx; cy = ty; cursorEl.classList.add('is-on'); }
  const hit = e.target.closest('.rw__hit');
  const isFocus = hit && (S.grid || mod(+hit.dataset.a - Math.round(S.target) + LOOKS.length/2, LOOKS.length) - LOOKS.length/2 === 0);
  cursorEl.classList.toggle('is-view', !!isFocus);
  cursorEl.classList.toggle('is-link', !!hit && !isFocus);
  if(!cursorRaf) cursorRaf = requestAnimationFrame(cursorFollow);
}
function cursorFollow(){
  cursorRaf = 0;
  cx += (tx - cx) * 0.18; cy += (ty - cy) * 0.18;
  cursorEl.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
  if(Math.abs(tx - cx) + Math.abs(ty - cy) > 0.4) cursorRaf = requestAnimationFrame(cursorFollow);
}
stage.addEventListener('pointerleave', () => cursorEl.classList.remove('is-on','is-view','is-link'));

/* ============================================================ GRID MODE */
document.querySelectorAll('.rw__vbtn').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.v === 'grid'));
});
function setView(grid){
  if(grid === S.grid) return;
  S.grid = grid;
  stopAuto();
  rw.classList.toggle('is-grid', grid);
  document.querySelectorAll('.rw__vbtn').forEach(b =>
    b.setAttribute('aria-pressed', String((b.dataset.v === 'grid') === grid)));
  stage.setAttribute('aria-roledescription', grid ? 'grid of looks' : 'carousel');

  /* a CSS transition does the morph, so we only need to set the end state */
  rw.classList.add('is-anim');
  S.items.forEach((it, i) => { it.el.style.setProperty('--d', (i * 0.02).toFixed(2) + 's'); });
  nextFrame(() => {
    if(grid) layoutGrid(); else { dirty = true; }
  });
  setTimeout(() => rw.classList.remove('is-anim'), 1700);
}

/* ============================================================ LIGHTBOX */
/* FLIP animation: the focused billboard in the ring flies up into the
   lightbox. We measure the source rect and the destination rect and
   apply the inverse transform, then let CSS animate it back to identity
   — that is why it looks like one continuous object. */
let lbModel = null;

function openLightbox(pin){
  if(S.zoomed) return;
  stopAuto();
  const look = LOOKS[S.index];
  const src  = S.items[S.index].fig.getBoundingClientRect();

  lbStage.innerHTML = '';
  const model = document.createElement('div');
  model.className = 'rw__lb-model';
  model.style.setProperty('--model-h', S.modelH + 'px');
  model.style.setProperty('--foot', String(look.foot));
  model.innerHTML =
    `<div class="rw__fig">
       <img src="${figureSVG(look.pal)}" alt="${look.name}" draggable="false">
       <div class="rw__pins">
         ${look.pins.map((p, i) => {
            const piece = look.pieces[i];
            return `<button class="rw__pin" type="button" data-p="${i+1}"
                      style="left:${p[0]}%;top:${p[1]}%"
                      aria-label="${piece.name}, ${money(piece.price)}">
                      <span>${i+1}</span>
                      <span class="rw__tip"><b>${piece.name}</b><span>${money(piece.price)}</span></span>
                    </button>`;
         }).join('')}
       </div>
     </div>`;
  lbStage.appendChild(model);
  lbModel = model;

  const dst = model.querySelector('.rw__fig').getBoundingClientRect();
  const sx = src.width / dst.width, sy = src.height / dst.height;

  model.style.transformOrigin = '0 0';
  model.style.transition = 'none';
  model.style.transform = `translate(${src.left - dst.left}px, ${src.top - dst.top}px) scale(${sx}, ${sy})`;

  S.zoomed = true;
  rw.classList.add('is-zoom');
  lbEl.setAttribute('aria-hidden', 'false');

  nextFrame(() => {
    model.style.transition = '';
    model.style.transform = 'none';
  });

  if(pin) setTimeout(() => hotPin(pin), 420);
  $('lbclose').focus({preventScroll:true});
}

function hotPin(p){
  const el = lbStage.querySelector(`.rw__pin[data-p="${p}"]`);
  if(!el) return;
  lbStage.querySelectorAll('.rw__pin').forEach(n => n.classList.remove('is-hot'));
  el.classList.add('is-hot');
}

function closeLightbox(){
  if(!S.zoomed || !lbModel) return;
  const look = LOOKS[S.index];
  const src  = S.items[S.index].fig.getBoundingClientRect();
  const dst  = lbModel.querySelector('.rw__fig').getBoundingClientRect();
  const sx = src.width / dst.width, sy = src.height / dst.height;

  lbModel.style.transition = 'none';
  lbModel.style.transformOrigin = '0 0';
  lbModel.style.transform = 'none';
  void lbModel.offsetWidth;
  lbModel.style.transition = '';
  lbModel.style.transform = `translate(${src.left - dst.left}px, ${src.top - dst.top}px) scale(${sx}, ${sy})`;

  S.zoomed = false;
  rw.classList.remove('is-zoom');
  lbEl.setAttribute('aria-hidden', 'true');
  setTimeout(() => { if(lbModel){ lbModel.remove(); lbModel = null; } }, 950);
  stage.focus({preventScroll:true});
}

$('lbclose').addEventListener('click', closeLightbox);
lbStage.addEventListener('click', (e) => {
  const pin = e.target.closest('.rw__pin');
  if(pin){
    hotPin(+pin.dataset.p);
    const piece = LOOKS[S.index].pieces[+pin.dataset.p - 1];
    $('bagCount').textContent = String(+$('bagCount').textContent + 1);
    toast(`${piece.name} added to bag`);
    return;
  }
  if(!e.target.closest('.rw__fig')) closeLightbox();
});

let toastTimer = 0;
function toast(msg){
  let t = $('toast');
  if(!t){
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%) translateY(10px);'
      + 'background:#0f0f0f;color:#ececec;padding:9px 16px;border-radius:999px;font-size:12px;'
      + 'letter-spacing:.06em;opacity:0;transition:.3s;pointer-events:none;z-index:100';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(-50%) translateY(10px)';
  }, 2200);
}

$('plus').addEventListener('click', () => openLightbox());

/* =============================================================== INDEX */
const idxList = $('idxlist');
LOOKS.forEach((look, i) => {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.className = 'rw__idx-item';
  b.dataset.i = String(i);
  b.innerHTML = `<span class="cap">${pad(i+1)}</span>
                 <span class="rw__idx-name">${look.name}</span>
                 <span class="cap">${look.pieces.length} pcs</span>`;
  li.appendChild(b);
  idxList.append(li);
});
idxList.addEventListener('click', (e) => {
  const b = e.target.closest('.rw__idx-item');
  if(!b) return;
  goTo(+b.dataset.i);
  toggleIndex(false);
});
$('idxclose').addEventListener('click', () => toggleIndex(false));
$('indexbtn').addEventListener('click', () => toggleIndex(!rw.classList.contains('is-index')));
function toggleIndex(open){
  rw.classList.toggle('is-index', open);
  idxEl.setAttribute('aria-hidden', String(!open));
  $('indexbtn').setAttribute('aria-expanded', String(open));
  if(open) stopAuto();
}

/* ================================================================ BOOT */
function layout(){ if(S.grid) layoutGrid(); else layoutRing(); }
function kick(){ dirty = true; }

let inView = true;
new ResizeObserver(() => { measure(); dirty = true; }).observe(stage);
if('IntersectionObserver' in window){
  new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].isIntersecting;
  }).observe(stage);
}
document.addEventListener('visibilitychange', () => { if(!document.hidden) dirty = true; });

/* clock in the chrome */
const clockEl = $('clock');
const tickClock = () => {
  clockEl.textContent = new Intl.DateTimeFormat(undefined, {hour:'2-digit', minute:'2-digit'}).format(new Date());
  setTimeout(tickClock, 60000 - Date.now() % 60000 + 50);
};
tickClock();

measure();
layout();
setIndex(0, true);
S.target = 0;
S.cur = S.reduced ? 0 : -1.15;   /* start slightly turned so the ring springs into place */
dirty = true;
startAuto();

/* expose the internals for debugging / tinkering in the console */
window.RING = S;
window.CFG = CFG;
S.tick = tick;              /* force a frame: RING.tick() */
S.layout = layout;
S.goTo = goTo;

})();
