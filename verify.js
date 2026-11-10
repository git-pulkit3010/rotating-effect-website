/* Compare the ORIGINAL site's ring maths (transcribed from
   demo.filatov.design/offline -> assets/index-*.js, function ue())
   against the remake's maths (app.js -> layoutRing()).

   For every item at a range of rotation angles we compare:
     - screen x of the item centre
     - screen y of the item's ground line
     - the scale factor
     - the blur radius
   Run:  node verify.js
*/
const TAU = Math.PI * 2;
const clamp = (v,a,b)=>v<a?a:v>b?b:v;
const mod = (n,m)=>((n%m)+m)%m;
const wrap = a=>{a=mod(a,TAU); if(a>Math.PI)a-=TAU; if(a<=-Math.PI)a+=TAU; return a;};

const W = 390, H = 844, N = 9;             // mobile viewport, 9 looks
const MODEL_H = Math.max(200, Math.round((H - 168 - 18 - 136) / 1.12));

/* ---------------- ORIGINAL (from the shipped bundle) ---------------- */
function original(cur){
  const R  = W * 0.84;          // s.Rm
  const P  = W * 1.10;          // s.Pm
  const front = 1.12;           // s.frontM
  const ringBottom = H - 168 - 40;                 // b - re - lift
  const horizon    = 136 + (H - 136) * 0.06 - 40;   // C + (b-C)*horizon - lift
  const ae = TAU / N;
  const out = [];
  for(let o = 0; o < N; o++){
    const c = wrap((o - cur) * ae);
    const l = P / (P + R * (1 - Math.cos(c)));
    const u = Math.abs(c) / ae;
    const ee = clamp(1 - u, 0, 1);
    const d = l * (1 + (front - 1) * ee);
    const f = W * 0.5 + R * Math.sin(c) * l;                 // x
    const p = horizon + (ringBottom - horizon) * l;           // y from top
    const m = u <= 1 ? 1.8 * u : Math.min(1.8 + (u - 1) * 2, 6.5);
    out.push({x:f, y:p, scale:d, blur:m});
  }
  return out;
}

/* ---------------- REMAKE (app.js) ---------------- */
function remake(cur){
  const R = W * 0.84, P = W * 1.10, front = 1.12;
  const ringBottom = H - 168 - 40;
  const horizon    = 136 + (H - 136) * 0.06 - 40;
  const ang = TAU / N;
  const out = [];
  for(let i = 0; i < N; i++){
    const a     = wrap((i - cur) * ang);
    const depth = P / (P + R * (1 - Math.cos(a)));
    const u     = Math.abs(a) / ang;
    const focus = clamp(1 - u, 0, 1);
    const scale = depth * (1 + (front - 1) * focus);
    const x     = W / 2 + R * Math.sin(a) * depth;
    const y     = horizon + (ringBottom - horizon) * depth;
    const blur  = u <= 1 ? 1.8 * u : Math.min(1.8 + (u - 1) * 2, 6.5);
    out.push({x, y, scale, blur});
  }
  return out;
}

let worst = 0, worstAt = '';
const rows = [];
for(const cur of [0, 0.13, 0.5, 1, 2.37, 3, 4.5, 6.13, 8, 8.87]){
  const A = original(cur), B = remake(cur);
  for(let i = 0; i < N; i++){
    for(const k of ['x','y','scale','blur']){
      const d = Math.abs(A[i][k] - B[i][k]);
      if(d > worst){ worst = d; worstAt = `cur=${cur} item=${i} ${k}: ${A[i][k]} vs ${B[i][k]}`; }
    }
  }
  rows.push(`cur=${cur.toFixed(2).padStart(5)}  item0 x=${B[0].x.toFixed(2)} scale=${B[0].scale.toFixed(4)} blur=${B[0].blur.toFixed(2)}  |  item4 x=${B[4].x.toFixed(2)} scale=${B[4].scale.toFixed(4)}`);
}

console.log('model height      :', MODEL_H, 'px');
console.log('ring radius R     :', (W*0.84).toFixed(1), 'px');
console.log('camera distance P :', (W*1.10).toFixed(1), 'px');
console.log('');
rows.forEach(r => console.log(r));
console.log('');
console.log(worst < 1e-9
  ? 'PASS - the remake reproduces the original geometry exactly (max delta ' + worst.toExponential(2) + ' px)'
  : 'FAIL - max delta ' + worst.toFixed(6) + ' at ' + worstAt);
