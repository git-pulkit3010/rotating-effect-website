# RING — a from-scratch remake of the rotating carousel

A rebuild of the "rotating ring" carousel from
<https://demo.filatov.design/offline/> — reverse-engineered from the shipped
bundle (`assets/index-*.js`), then rewritten from scratch as readable code.

```
ring-remake/
├── index.html    markup + chrome
├── styles.css    the visual language
├── app.js        the engine (geometry, spring, input, grid, lightbox)
└── verify.js     proves the geometry matches the original bit-for-bit
```

Open `index.html` — it is self-contained: the nine "looks" are generated as
inline SVG, so there are no image files and no network calls.

### Run it

```bash
git clone https://github.com/git-pulkit3010/rotating-effect-website.git
cd rotating-effect-website
python3 -m http.server 8000      # then open http://localhost:8000
```

It works straight from `file://` too — the whole thing is static.

### Continuous integration (optional)

The geometry check is a plain Node script — `node verify.js` — so it can run
anywhere. To have GitHub run it on every push, add this file as
`.github/workflows/verify.yml` (GitHub → *Add file* → *Create new file*):

```yaml
name: verify
on:
  push:
    branches: [main]
  pull_request:
jobs:
  geometry:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: node verify.js
```

Then the claim "the geometry is bit-identical to the original" is checked by
CI rather than merely asserted in this README.

---

## 1. The effect, explained

The "rotating" carousel is **not** CSS 3D. There is no `rotate3d()`, no
`perspective` property, no `transform-style: preserve-3d` anywhere.

Each look is a **flat billboard** standing on a **circle** that is viewed in
**perspective**. The circle lives in 3D; the camera projects it to 2D:

```
a      = (i - cur) * 2π/N         angle of look i around the circle
z      = R * (1 - cos a)           how far behind the camera plane it is
depth  = P / (P + z)               the perspective divide (P = camera distance)
focus  = 1 - |a| / (2π/N)         1 when the look is dead centre, 0 one step away
scale  = depth * (1 + (F-1)*focus)  F = extra "pop" for the look in focus
x      = cx + R * sin(a) * depth
y      = horizon + (floor - horizon) * depth     (ground line of the look)
blur   = grows with angular distance             (cheap depth of field)
```

Three details do all the work:

1. **The perspective divide shrinks `R·sin(a)` as well as the scale.** That is
   why the looks hug the centre line and curve away instead of sliding off to
   the sides — it is what makes the flat strip read as a *ring*.
2. **`y` is driven by `depth`, not by the angle.** Far looks sit near the
   horizon, near looks sit on the floor line, so the ring reads as a cylinder
   seen slightly from above.
3. **The figures never rotate.** They are billboarded: only their position and
   size change. Rotating them would look like a spinning drum of cardboard.

Every look keeps its own `transform` string and the browser only ever does
`translate3d() + scale()` — no per-frame layout, no per-frame repaint of the
artwork.

### The spring

Rotation is one float, `cur`, measured in **item units** (1.0 = one look
apart). The target is `target`. A critically damped spring chases it:

```
k = 95, c = 2·√k          (critical damping = no overshoot, no wobble)
acc  = -k·(cur - target) - c·vel
vel += acc·h
cur += vel·h
```

Every input — drag, flick momentum, wheel, arrow key, autoplay, tapping a
neighbour — only ever writes to `target`. The spring is the single place
where motion is produced, which is why the whole thing feels like one
physical object rather than five different animations.

`h` is `dt/3` with three substeps per frame, and `dt` is clamped.

---

## 2. The interactions

| Input | Behaviour |
|---|---|
| **Drag / swipe** | 8px of horizontal travel locks the gesture (vertical is released back to the page so touch scrolling still works). Dragging moves `target`; the ring lags slightly behind the finger — that lag *is* the feel. |
| **Release** | Touch: one flick = one step. Mouse/trackpad: the last 6 pointer samples give a velocity in px/ms, which is projected 160 ms forward and clamped to ±2 looks from where the drag started. |
| **Wheel / trackpad** | Horizontal `deltaX` only (vertical scroll passes through). Accumulates until 45px, then steps, with a 520 ms lockout so a trackpad flick can't fly through the whole catalogue. |
| **Keyboard** | ← → step, ↑ ↓ move a row in grid mode, Enter opens the look, Escape closes whatever is open. |
| **Autoplay** | Every 5 s, and it stops the moment the user touches anything, and resumes only when the tab is visible, the stage is on screen, and no overlay is open. |
| **Click a look** | If it is the focused one, it opens the lightbox; if it is a neighbour, the ring rotates to it. |
| **RING / GRID** | Morphs the same nine billboards into a 3-column sheet. |
| **INDEX** | A list of all the looks; tapping one rotates the ring to it. |

### The lightbox (FLIP)

Opening a look does not fade an overlay in. The focused billboard is measured,
a copy is mounted in the lightbox, and the copy is given the **inverse**
transform of the difference between the two rectangles; then the transform is
released and CSS animates it back to identity. The figure therefore appears
to fly up out of the ring rather than being replaced by a modal.

The copy carries numbered pins — the shoppable hotspots — positioned in
percentages of the figure box, so they survive any scale.

---

## 3. What is different from the original (and why)

The geometry is **identical** — `verify.js` compares the original's `ue()`
against this remake's `layoutRing()` for nine looks across ten rotation
angles and the maximum difference is `0.00e+0 px`:

```
$ node verify.js
model height      : 466 px
ring radius R     : 327.6 px
camera distance P : 429.0 px
cur= 0.00  item0 x=195.00 scale=1.1200 blur=0.00  |  item4 x=240.16 scale=0.4030
...
PASS - the remake reproduces the original geometry exactly (max delta 0.00e+0 px)
```

The behavioural differences are deliberate:

- **Fixed-step catch-up.** The original clamps `dt` to 34 ms, so when the frame
  rate drops the animation silently plays in *slow motion*. This version
  replays up to 8 fixed 1/60 s steps per frame, so it keeps real-time pace
  when frames are dropped and still cannot explode the spring after a stall.
- **The ring is never blank.** The original only starts rendering when an
  `IntersectionObserver` reports the stage as visible. In an embedded WebView
  (or any host that throttles `requestAnimationFrame`) that observer can
  report "not intersecting" forever and the stage stays empty. This version
  renders on load, keeps a timer-based fallback clock alive if rAF stops
  delivering, and only uses the observer to pause autoplay.
- **The focused look is lit.** The original dims every figure to 35 % opacity
  until you hover one. Here the focused look stays at full opacity and the
  rest sit at 42 %, which reads much better on a phone.
- **Centring is exact.** The original centres a billboard with
  `translateX(-50%)` *before* the scale, which is applied in unscaled pixels
  and leaves the figure a few pixels off centre at large scales. Here the
  offset is computed from the scaled width.

---

## 4. Making it yours

### Swap the artwork for photography

Every look is one `<img>` inside a `.rw__fig` box that is `aspect-ratio: 4/7`
tall. Drop in real photography and keep the ratio:

```js
{ name:'Do Not Disturb', foot:.04, img:'looks/01.jpg', pieces:[...] }
```

`foot` nudges the image down inside its box so the feet land exactly on the
ground line — it is a per-look alignment offset in fractions of the image
height. The original uses 0.012–0.095.

Use a transparent PNG (or a cut-out model) so the ring reads as one object
standing on one floor.

### The knobs

Everything visual lives in `CFG` at the top of `app.js`:

```js
radius:    0.44,   // ring radius as a fraction of the stage width
radiusMob: 0.84,   // mobile uses a wider ring -> you see more of the circle
persp:     0.80,   // camera distance. smaller = flatter / more dramatic
perspMob:  1.10,
horizon:   0.06,   // where the far side of the ring sits
fit:       1.12,   // model height vs available stage height
front:     1.165,  // extra scale for the look in focus
frontMob:  1.12,
step:      0.03,   // how far the focused look is pushed down (desktop only)
lift:      40,     // px the ring floats above the floor line
spring:    95,     // stiffness. lower = looser, higher = snappier
dragSpeed: 0.30,   // fraction of the stage width that equals one step
maxBlur:   6.5,
```

* **Wider ring / more looks on screen at once** → raise `radius`, raise `persp`.
* **Flatter, more editorial** → lower `persp` (0.55–0.7) and raise `radius`.
* **Snappier** → raise `spring` to 140–180 (keep `c = 2√k` for critical damping).
* **Heavier, more physical** → lower `spring` to 60–70 and lower the drag speed.

### Tinkering live

`window.RING` exposes the live state and `window.CFG` the tuning object:

```js
CFG.spring = 160;                    // snappier
RING.target = 3;                     // jump to look 4
RING.cur = 2.5; RING.layout();       // hard-set the angle and redraw
```

---

## 5. Checklist if you port this to a real product

- [ ] Replace the SVG with real product photography (transparent cut-outs).
- [ ] Persist `foot` per look — it is the difference between "aligned" and
      "slightly off".
- [ ] Keep `prefers-reduced-motion` handling: the remake snaps straight to
      the target instead of springing.
- [ ] The drag threshold (8px) and the wheel lockout (520ms) are the two
      numbers that decide whether the carousel feels precise or twitchy.
- [ ] If the stage can be off screen, do **not** gate the render loop on an
      `IntersectionObserver` — gate autoplay on it, and keep drawing.
- [ ] The blur is `filter: blur()` on the billboard. On low-end phones that
      is the most expensive thing on the page; lower `maxBlur` or drop to
      `opacity` dimming only if it stutters.
