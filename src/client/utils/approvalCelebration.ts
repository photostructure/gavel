import type { ApprovalAnimation } from '../components/SettingsModal';

// Units are CSS pixels and simulated seconds; SPEED converts them to real time.
const GRAVITY = 800;
const FADE = 0.8;
const STEP = 1 / 120;
const MAX_FRAME = 0.1;
/** Simulated seconds per real second: bursts play at double speed along unchanged paths. */
const SPEED = 2;
/** No burst lasts longer than this many real seconds, however long its own duration. */
const MAX_SECONDS = 3;
/** Longer than any screen's diagonal, so laser beams always reach the edge. */
const BEAM_LENGTH = 4000;
const PALETTE = [
  '#f43f5e',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
];
const LASER_COLORS = ['#39ff14', '#ff3131', '#00e5ff', '#ff2bd6', '#3d5afe'];

type PieceKind =
  | 'paper'
  | 'ribbon'
  | 'sparkle'
  | 'rocket'
  | 'ember'
  | 'stamp'
  | 'ink'
  | 'laser'
  | 'disco'
  | 'balloon';

/**
 * Ribbons fall slower than paper, and balloons rise; the stamp, its ink, lasers,
 * and the disco ball ignore gravity.
 */
const GRAVITY_SCALE: Record<PieceKind, number> = {
  paper: 1,
  ribbon: 0.7,
  sparkle: 0.15,
  rocket: 1,
  ember: 0.35,
  stamp: 0,
  ink: 0,
  laser: 0,
  disco: 0,
  balloon: -0.45,
};

/**
 * Streamers port the ribbon shape from tsParticles 4.4.0 (@tsparticles/shape-ribbon,
 * with the defaults of @tsparticles/ribbons), which descends from iprodev's
 * "Confetti with ribbons" (codepen.io/iprodev/pen/azpWBr).
 *
 * MIT License, Copyright (c) 2020 Matteo Bruni. Permission is hereby granted, free
 * of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and
 * to permit persons to whom the Software is furnished to do so, subject to the
 * following conditions: The above copyright notice and this permission notice
 * shall be included in all copies or substantial portions of the Software. THE
 * SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
interface RibbonPoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Points along a ribbon, and the distance between neighbors. */
const RIBBON_POINTS = 60;
const RIBBON_SPACING = 8;
/** Air drag on each point, proportional to the square of its speed. */
const RIBBON_DRAG = 0.02;
/** The most pull, in px/s², that a point gets toward the one ahead of it. */
const RIBBON_MAX_PULL = 800;

interface Piece {
  kind: PieceKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Linear air drag per second; paper scales it by how face-on it is to the fall. */
  drag: number;
  color: string;
  /** Paper, ribbon, and stamp width, sparkle and ember size, or disco ball and balloon radius. */
  width: number;
  /** Paper height, or the angle between a laser's beams. */
  height: number;
  /**
   * In-plane rotation: tumble, spin, the on-screen direction of a ribbon's width
   * at its leading end, a laser's sweep phase, the disco ball's turn, or the
   * phase of a balloon's rock.
   */
  spin: number;
  spinRate: number;
  /** How far a ribbon's width direction turns from one point to the next, in radians. */
  twist: number;
  /**
   * Out-of-plane rotation: paper's visible face width, a laser's brightness
   * pulse, or the seed for a stamp's worn ink.
   */
  flip: number;
  flipRate: number;
  /**
   * Phase and strength of the sideways lift that makes pieces sway as they move.
   * A ribbon's leading end swings from side to side at `swayRate` instead.
   */
  sway: number;
  swayRate: number;
  swayForce: number;
  /**
   * A ribbon's points, or a balloon's string, from its leading end back. Each is
   * pulled toward the one ahead with this much force per px/s the leading end
   * moves. Empty for other pieces.
   */
  chain: RibbonPoint[];
  follow: number;
  /** Laser beams, worn spots in a stamp's ink, or disco ball light specks. */
  parts: number;
  /** Where a laser points first (the Approve button), or where the disco ball comes to rest. */
  targetX: number;
  targetY: number;
  /**
   * How far the disco ball throws its light specks, or how fast a ribbon's
   * leading end swings (its swing is this divided by `swayRate` to each side).
   */
  reach: number;
  /** Seconds since launch; negative while a firework waits its turn. */
  age: number;
  /** Seconds left to live; most pieces last until they leave the screen. */
  life: number;
}

const random = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)] as T;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

interface Launch {
  origin: DOMRect;
  cx: number;
  cy: number;
  /** Direction toward the middle of the viewport, so the pieces stay on screen. */
  aim: number;
  viewport: { width: number; height: number };
}

const still = {
  vx: 0,
  vy: 0,
  drag: 0,
  width: 0,
  height: 0,
  spin: 0,
  spinRate: 0,
  flip: 0,
  flipRate: 0,
  twist: 0,
  sway: 0,
  swayRate: 0,
  swayForce: 0,
  // Shared by every piece that spreads `still`; ribbons and balloons replace it.
  chain: [] as RibbonPoint[],
  follow: 0,
  parts: 0,
  targetX: 0,
  targetY: 0,
  reach: 0,
  age: 0,
  life: Infinity,
};

const BURSTS: Record<
  ApprovalAnimation,
  { count: number; duration: number; make: (at: Launch) => Piece }
> = {
  confetti: {
    count: 140,
    duration: 4.2,
    make: ({ origin, cy, aim }) => {
      const angle = aim + random(-1, 1) * random(0.3, 1.1);
      const speed = random(600, 1800);
      const width = random(5, 9);
      return {
        ...still,
        kind: 'paper',
        x: random(origin.left, origin.right),
        y: cy + random(-4, 4),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - random(150, 450),
        drag: random(2.4, 3.6),
        color: pick(PALETTE),
        width,
        height: width * random(0.45, 1.6),
        spin: random(0, Math.PI * 2),
        spinRate: random(-9, 9),
        flip: random(0, Math.PI * 2),
        flipRate: random(6, 16),
        sway: random(0, Math.PI * 2),
        swayRate: random(2.5, 5),
        swayForce: random(120, 320),
      };
    },
  },
  // Paper streamers fly out of the Approve button, trailing behind them, and drift
  // down swinging from side to side. See RibbonPoint for where the shape comes from.
  streamers: {
    count: 16,
    duration: 5.5,
    make: ({ origin, cy, aim }) => {
      const angle = aim + random(-1, 1);
      const speed = random(700, 1500);
      const x = random(origin.left, origin.right);
      // The strip starts laid out behind its leading end, with a little crumple.
      const back = angle + Math.PI;
      const chain = Array.from({ length: RIBBON_POINTS }, (_, i) => {
        const crumple = random(-0.25, 0.25) * RIBBON_SPACING;
        return {
          x: x + Math.cos(back) * i * RIBBON_SPACING - Math.sin(back) * crumple,
          y: cy + Math.sin(back) * i * RIBBON_SPACING + Math.cos(back) * crumple,
          vx: 0,
          vy: 0,
        };
      });
      return {
        ...still,
        kind: 'ribbon',
        x,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - random(200, 450),
        // Falls at about 250–350 px/s, about twice as fast as tsParticles' ribbons,
        // which move half their 4–6 speed (2–3 px) a frame.
        drag: random(1.6, 2.2),
        color: pick(PALETTE),
        width: 8,
        sway: random(0, Math.PI * 2),
        // The width turns along the strip, so it twists from the moment it leaves the
        // button: a half turn every 25–50 points (200–400 px), rolling along over time.
        spin: random(0, Math.PI * 2),
        spinRate: random(1.5, 3) * (Math.random() < 0.5 ? -1 : 1),
        twist: random(Math.PI / 50, Math.PI / 25) * (Math.random() < 0.5 ? -1 : 1),
        swayRate: random(3, 5),
        reach: random(100, 140),
        chain,
        follow: random(4, 6),
      };
    },
  },
  sparkles: {
    count: 90,
    duration: 4.2,
    make: ({ cx, cy }) => {
      const angle = random(0, Math.PI * 2);
      const speed = random(150, 900);
      return {
        ...still,
        kind: 'sparkle',
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        drag: random(3, 6),
        color: pick(['#fde047', '#fef9c3', '#fbbf24', '#ffffff']),
        width: random(4, 9),
        spin: random(0, Math.PI),
        spinRate: random(-6, 6),
        life: random(0.7, 1.6),
      };
    },
  },
  // Rockets launch from the bottom edge, one after another, and burst at the top of their arc.
  fireworks: {
    count: 5,
    duration: 4.5,
    make: ({ viewport }) => {
      const rise = random(0.45, 0.75) * viewport.height;
      return {
        ...still,
        kind: 'rocket',
        x: random(0.15, 0.85) * viewport.width,
        y: viewport.height + 10,
        vx: random(-60, 60),
        // Without drag, this speed peaks exactly `rise` above the launch point.
        vy: -Math.sqrt(2 * GRAVITY * rise),
        color: pick(PALETTE),
        width: 2.5,
        age: -random(0, 1.2),
      };
    },
  },
  // A rubber stamp slams down on the middle of the page and leaves a dated APPROVED mark.
  stamp: {
    count: 1,
    duration: 3.4,
    make: ({ viewport }) => ({
      ...still,
      kind: 'stamp',
      x: viewport.width / 2,
      y: viewport.height * 0.42,
      color: '#16a34a',
      width: Math.min(viewport.width * 0.7, 440),
      spin: random(0.1, 0.22) * (Math.random() < 0.5 ? -1 : 1),
      flip: random(0, 1000),
      parts: 260,
    }),
  },
  // Emitters along the bottom edge aim their beams at the Approve button, then sweep.
  lasers: {
    count: 6,
    duration: 4,
    make: ({ cx, cy, viewport }) => ({
      ...still,
      kind: 'laser',
      x: random(0.06, 0.94) * viewport.width,
      y: viewport.height + 2,
      color: pick(LASER_COLORS),
      height: random(0.07, 0.14),
      spin: random(0, Math.PI * 2),
      spinRate: random(1.4, 2.4) * (Math.random() < 0.5 ? -1 : 1),
      flip: random(0, Math.PI * 2),
      flipRate: random(7, 12),
      parts: pick([3, 4, 5]),
      targetX: cx,
      targetY: cy,
    }),
  },
  // One mirror ball drops in on a line, bobs to rest, spins, and rises back out.
  disco: {
    count: 1,
    duration: 5,
    make: ({ viewport }) => ({
      ...still,
      kind: 'disco',
      x: viewport.width / 2,
      y: -60,
      drag: 6,
      color: '#cbd5e1',
      width: 40,
      spinRate: 1.6,
      parts: 90,
      targetY: viewport.height * 0.24,
      reach: viewport.width * 0.6,
    }),
  },
  // Balloons float up from the bottom edge, one after another, trailing their strings.
  balloons: {
    count: 14,
    duration: 6.5,
    make: ({ viewport }) => {
      const width = random(18, 32);
      const x = random(0.08, 0.92) * viewport.width;
      const y = viewport.height + 30;
      const knotY = y + width * (BALLOON_ASPECT + BALLOON_KNOT);
      // The string starts hanging straight down from the knot.
      const chain = Array.from({ length: BALLOON_STRING_POINTS }, (_, i) => ({
        x,
        y: knotY + i * RIBBON_SPACING,
        vx: 0,
        vy: 0,
      }));
      return {
        ...still,
        kind: 'balloon',
        x,
        y,
        // Starts at the speed its lift and drag settle on: 800 × 0.45 / 1.2 = 300 px/s.
        vy: -300,
        drag: 1.2,
        color: pick(PALETTE),
        width,
        // Rocks gently on its string as it rises.
        spin: random(0, Math.PI * 2),
        spinRate: random(1.5, 2.6),
        sway: random(0, Math.PI * 2),
        swayRate: random(1.2, 2.2),
        swayForce: random(60, 140),
        chain,
        // A rising balloon's knot moves fast enough that the pull on its string always
        // reaches RIBBON_MAX_PULL, so any follow strength above 800 / 300 acts the same.
        follow: 4,
        age: -random(0, 1.4),
      };
    },
  },
};

/** A balloon's half-height, and its knot's length, as multiples of its half-width. */
const BALLOON_ASPECT = 1.2;
const BALLOON_KNOT = 0.22;
/** How opaque a balloon is. */
const BALLOON_OPACITY = 0.8;
/** Points in a balloon's string, spaced like a ribbon's. */
const BALLOON_STRING_POINTS = 12;

/** Where a balloon's string is tied: under the knot, which tilts with the balloon. */
function balloonKnot(balloon: Piece) {
  const tilt = balloonTilt(balloon);
  const reach = balloon.width * (BALLOON_ASPECT + BALLOON_KNOT);
  return { x: balloon.x - Math.sin(tilt) * reach, y: balloon.y + Math.cos(tilt) * reach };
}

/**
 * A balloon drifting sideways leans its top into the drift (its sway peaks near
 * 90 px/s, about 13°), and rocks about 5° either way.
 */
const balloonTilt = (balloon: Piece) => balloon.vx / 400 + Math.sin(balloon.spin) * 0.08;

/** The disco ball rests on its line this long before it is pulled back up. */
const DISCO_REST = 3.6;

function burstRocket(rocket: Piece, spawn: (piece: Piece) => void) {
  for (let i = 0; i < 64; i++) {
    const angle = (i / 64) * Math.PI * 2 + random(-0.05, 0.05);
    // Most embers fly at one speed so the burst reads as a ring; the rest fill it in.
    const speed = Math.random() < 0.7 ? random(230, 260) : random(40, 220);
    spawn({
      ...still,
      kind: 'ember',
      x: rocket.x,
      y: rocket.y,
      vx: Math.cos(angle) * speed + rocket.vx,
      vy: Math.sin(angle) * speed,
      drag: random(1.1, 1.5),
      color: Math.random() < 0.15 ? '#ffffff' : rocket.color,
      width: random(1.5, 2.5),
      life: random(1.1, 1.7),
    });
  }
}

function step(piece: Piece, dt: number, spawn: (piece: Piece) => void) {
  piece.age += dt;
  if (piece.age < 0) return;
  piece.spin += piece.spinRate * dt;
  piece.flip += piece.flipRate * dt;
  piece.sway += piece.swayRate * dt;
  if (piece.kind === 'disco') {
    // A spring on the line pulls the ball to its resting height, then back up out of sight.
    const target = piece.age < DISCO_REST ? piece.targetY : -piece.width * 4;
    piece.vy += (target - piece.y) * 30 * dt;
  }
  // A piece edge-on to the air falls fastest; face-on, it catches the air and slows.
  const drag =
    piece.kind === 'paper'
      ? piece.drag * (0.35 + 0.65 * Math.abs(Math.cos(piece.flip)))
      : piece.drag;
  const damping = Math.exp(-drag * dt);
  piece.vx = (piece.vx + Math.sin(piece.sway) * piece.swayForce * dt) * damping;
  piece.vy = (piece.vy + GRAVITY * GRAVITY_SCALE[piece.kind] * dt) * damping;
  piece.x += piece.vx * dt;
  piece.y += piece.vy * dt;
  piece.life -= dt;

  if (piece.kind === 'ribbon') {
    // The leading end swings from side to side about the ribbon's position.
    const swing = (Math.cos(piece.sway) * piece.reach) / piece.swayRate;
    stepChain(piece, piece.x + swing, piece.y, dt);
  }
  if (piece.kind === 'balloon') {
    const knot = balloonKnot(piece);
    stepChain(piece, knot.x, knot.y, dt);
  }
  if (piece.kind === 'rocket') {
    if (Math.random() < 0.5) {
      spawn({
        ...still,
        kind: 'ember',
        x: piece.x,
        y: piece.y,
        vx: random(-20, 20),
        vy: random(0, 40),
        drag: 3,
        color: '#fde68a',
        width: 1.2,
        life: random(0.25, 0.45),
      });
    }
    if (piece.vy >= 0) {
      piece.life = 0;
      burstRocket(piece, spawn);
    }
  }
  if (piece.kind === 'stamp' && piece.age >= STAMP_DROP && piece.age - dt < STAMP_DROP) {
    splatterStamp(piece, spawn);
  }
}

/**
 * tsParticles' `updateRibbon`: moves a chain's first point to (`x`, `y`) and has
 * the rest follow it, for a ribbon or a balloon's string.
 */
function stepChain(piece: Piece, x: number, y: number, dt: number) {
  const { chain } = piece;
  const head = chain[0] as RibbonPoint;
  const moved = Math.hypot(x - head.x, y - head.y);
  head.x = x;
  head.y = y;
  // The faster the first point moves, the harder each point is pulled toward the one ahead.
  const pull = Math.min((moved / dt) * piece.follow, RIBBON_MAX_PULL);
  // Going from the tail forward, each point's pull is figured before the point ahead
  // of it moves, as when tsParticles finds every force before integrating any.
  for (let i = chain.length - 1; i > 0; i--) {
    const point = chain[i] as RibbonPoint;
    const ahead = chain[i - 1] as RibbonPoint;
    const dx = ahead.x - point.x;
    const dy = ahead.y - point.y;
    const distance = Math.hypot(dx, dy);
    const speed = Math.hypot(point.vx, point.vy);
    point.x += point.vx * dt;
    point.y += point.vy * dt;
    point.vx += ((dx / distance) * pull - point.vx * RIBBON_DRAG * speed) * dt;
    point.vy += ((dy / distance) * pull - point.vy * RIBBON_DRAG * speed) * dt;
  }
  // Then each point is put back a fixed distance behind the one ahead.
  for (let i = 1; i < chain.length; i++) {
    const point = chain[i] as RibbonPoint;
    const ahead = chain[i - 1] as RibbonPoint;
    const dx = point.x - ahead.x;
    const dy = point.y - ahead.y;
    const distance = Math.hypot(dx, dy);
    point.x = ahead.x + (dx / distance) * RIBBON_SPACING;
    point.y = ahead.y + (dy / distance) * RIBBON_SPACING;
  }
}

/** The stamp falls this long before it hits the page. */
const STAMP_DROP = 0.32;
/** The stamp's height as a fraction of its width. */
const STAMP_ASPECT = 0.42;

/** A stable pseudo-random number in [0, 1), so a stamp's worn spots stay put between frames. */
const hash = (n: number) => {
  const s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
};

function splatterStamp(stamp: Piece, spawn: (piece: Piece) => void) {
  const halfWidth = stamp.width / 2;
  const halfHeight = (stamp.width * STAMP_ASPECT) / 2;
  for (let i = 0; i < 48; i++) {
    // Ink squeezes out from under the stamp's edge and flies away from it.
    const angle = random(0, Math.PI * 2);
    const edgeX = Math.cos(angle) * halfWidth;
    const edgeY = Math.sin(angle) * halfHeight;
    const speed = random(120, 520);
    spawn({
      ...still,
      kind: 'ink',
      x: stamp.x + edgeX * Math.cos(stamp.spin) - edgeY * Math.sin(stamp.spin),
      y: stamp.y + edgeX * Math.sin(stamp.spin) + edgeY * Math.cos(stamp.spin),
      vx: Math.cos(angle + stamp.spin) * speed,
      vy: Math.sin(angle + stamp.spin) * speed,
      drag: random(9, 14),
      color: stamp.color,
      width: random(1.5, 4.5),
    });
  }
}

function drawPaper(ctx: CanvasRenderingContext2D, piece: Piece) {
  ctx.save();
  ctx.translate(piece.x, piece.y);
  ctx.rotate(piece.spin);
  const face = Math.cos(piece.flip);
  ctx.scale(1, face);
  ctx.fillStyle = piece.color;
  ctx.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
  // Shade the back of the paper as it turns over.
  if (face < 0) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
  }
  ctx.restore();
}

/** tsParticles' ribbon `darken`: the same hue and saturation, `amount` points less lightness. */
function darken(hex: string, amount: number) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const chroma = max - min;
  const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * lightness - 1));
  const sector =
    chroma === 0
      ? 0
      : max === r
        ? ((g - b) / chroma + 6) % 6
        : max === g
          ? (b - r) / chroma + 2
          : (r - g) / chroma + 4;
  return `hsl(${sector * 60} ${saturation * 100}% ${Math.max(0, lightness * 100 - amount)}%)`;
}

/**
 * tsParticles' `drawRibbon`, except that the width's on-screen direction turns
 * along the strip instead of staying at 45°, and its ends are cut square
 * instead of notched.
 */
function drawRibbon(ctx: CanvasRenderingContext2D, piece: Piece) {
  const edges = piece.chain.map((point, i) => {
    const angle = piece.spin + i * piece.twist;
    return {
      x: point.x,
      y: point.y,
      ox: Math.cos(angle) * piece.width,
      oy: Math.sin(angle) * piece.width,
    };
  });
  // The strip narrows to an edge where it heads along its width, and past that
  // shows its back. Each face's segments go into one path filled once, so they
  // leave no gaps where they meet and don't blend over each other while the burst
  // fades out (tsParticles fills and strokes each segment).
  for (const showsBack of [false, true]) {
    ctx.beginPath();
    for (const [i, a] of edges.entries()) {
      const b = edges[i + 1];
      if (!b) break;
      if ((a.x - b.x) * (a.oy + b.oy) - (a.y - b.y) * (a.ox + b.ox) < 0 === showsBack) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x + b.ox, b.y + b.oy);
      ctx.lineTo(a.x + a.ox, a.y + a.oy);
      ctx.closePath();
    }
    ctx.fillStyle = showsBack ? darken(piece.color, 30) : piece.color;
    ctx.fill();
  }
}

function drawSparkle(ctx: CanvasRenderingContext2D, piece: Piece) {
  // A four-point twinkle that shrinks as it burns out.
  const radius = piece.width * clamp01(piece.life / 0.4);
  const inner = radius * 0.28;
  ctx.save();
  ctx.translate(piece.x, piece.y);
  ctx.rotate(piece.spin);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? radius : inner;
    const a = (i * Math.PI) / 4;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = piece.color;
  ctx.shadowColor = piece.color;
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.restore();
}

/** Rockets, embers, and ink drops draw as short streaks behind their direction of travel. */
function drawStreak(ctx: CanvasRenderingContext2D, piece: Piece, length: number) {
  ctx.save();
  if (piece.kind === 'ember') ctx.globalAlpha *= clamp01(piece.life / 0.5);
  ctx.strokeStyle = piece.kind === 'rocket' ? '#fde68a' : piece.color;
  ctx.lineWidth = piece.width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(piece.x, piece.y);
  ctx.lineTo(piece.x - piece.vx * length, piece.y - piece.vy * length);
  ctx.stroke();
  ctx.restore();
}

function drawStamp(ctx: CanvasRenderingContext2D, piece: Piece) {
  const w = piece.width;
  const h = w * STAMP_ASPECT;
  const landed = piece.age >= STAMP_DROP;
  const fall = clamp01(piece.age / STAMP_DROP);
  const since = piece.age - STAMP_DROP;
  // It falls toward the page, shrinking to its true size and straightening, then shudders on impact.
  const scale = landed
    ? 1 - 0.06 * Math.exp(-since * 14) * Math.sin(since * 40)
    : 1 + 1.6 * (1 - fall * fall);
  const shake = landed ? 5 * Math.exp(-since * 16) * Math.sin(since * 90) : 0;
  ctx.save();
  ctx.translate(piece.x + shake, piece.y);
  ctx.rotate(piece.spin * (landed ? 1 : 3 - 2 * fall));
  ctx.scale(scale, scale);
  // Until it lands, the stamp is a faint shape above the page.
  ctx.globalAlpha *= landed ? 0.92 : 0.3 * fall;
  ctx.strokeStyle = piece.color;
  ctx.fillStyle = piece.color;
  ctx.lineWidth = h * 0.07;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, h * 0.12);
  ctx.stroke();
  const inset = h * 0.11;
  ctx.lineWidth = h * 0.025;
  ctx.beginPath();
  ctx.roundRect(-w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2, h * 0.06);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${h * 0.42}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText('APPROVED', 0, -h * 0.06, w - h * 0.5);
  ctx.font = `700 ${h * 0.12}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const date = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  ctx.fillText(date.toUpperCase(), 0, h * 0.25, w - h * 0.5);

  // Uneven pressure and specks of missing ink make it read as rubber on paper.
  ctx.globalCompositeOperation = 'destination-out';
  const pressure = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  pressure.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
  pressure.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
  pressure.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
  ctx.fillStyle = pressure;
  ctx.fillRect(-w / 2 - h, -h, w + h * 2, h * 2);
  ctx.fillStyle = '#000000';
  for (let i = 0; i < piece.parts; i++) {
    const size = hash(piece.flip + i * 1.31);
    ctx.beginPath();
    ctx.arc(
      (hash(piece.flip + i * 3.17) - 0.5) * w * 1.05,
      (hash(piece.flip + i * 7.73) - 0.5) * h * 1.05,
      ((0.5 + (size > 0.92 ? 4 : 1.6) * size) * w) / 440,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawLaser(ctx: CanvasRenderingContext2D, piece: Piece) {
  const toButton = Math.atan2(piece.targetY - piece.y, piece.targetX - piece.x);
  const sweep = -Math.PI / 2 + Math.sin(piece.spin) * 0.8;
  // The beams lock onto the Approve button together, then break away into sweeps.
  const t = clamp01((piece.age - 0.6) / 0.6);
  const release = t * t * (3 - 2 * t);
  const center = toButton + (sweep - toButton) * release;
  const spread = piece.height * release;
  const alpha = ctx.globalAlpha * clamp01(piece.age / 0.12) * (0.7 + 0.3 * Math.sin(piece.flip));

  ctx.save();
  // Additive light: crossing beams flare brighter, like stage haze.
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = piece.color;
  ctx.fillStyle = piece.color;
  ctx.lineCap = 'round';
  for (let beam = 0; beam < piece.parts; beam++) {
    const angle = center + (beam - (piece.parts - 1) / 2) * spread;
    ctx.beginPath();
    ctx.moveTo(piece.x, piece.y);
    ctx.lineTo(piece.x + Math.cos(angle) * BEAM_LENGTH, piece.y + Math.sin(angle) * BEAM_LENGTH);
    ctx.globalAlpha = alpha * 0.16;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.9;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(piece.x, piece.y - 1, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBalloon(ctx: CanvasRenderingContext2D, piece: Piece) {
  const w = piece.width;
  const h = w * BALLOON_ASPECT;

  // A thin string, drawn first so the knot covers its top end.
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const [i, point] of piece.chain.entries()) {
    if (i === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();

  ctx.translate(piece.x, piece.y);
  ctx.rotate(balloonTilt(piece));
  // Thin rubber lets a little of the page show through.
  ctx.globalAlpha *= BALLOON_OPACITY;
  // The tied-off knot, a shade darker than the balloon.
  ctx.beginPath();
  ctx.moveTo(0, h - 1);
  ctx.lineTo(w * 0.17, h + w * BALLOON_KNOT);
  ctx.lineTo(-w * 0.17, h + w * BALLOON_KNOT);
  ctx.closePath();
  ctx.fillStyle = piece.color;
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.fill();

  // A rubber balloon is rounder on top and tapers to the knot.
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.bezierCurveTo(-w * 0.35, h * 0.85, -w, h * 0.35, -w, -h * 0.15);
  ctx.bezierCurveTo(-w, -h * 0.75, -w * 0.55, -h, 0, -h);
  ctx.bezierCurveTo(w * 0.55, -h, w, -h * 0.75, w, -h * 0.15);
  ctx.bezierCurveTo(w, h * 0.35, w * 0.35, h * 0.85, 0, h);
  ctx.closePath();
  ctx.fillStyle = piece.color;
  ctx.fill();
  // Lit from the upper right, like tsParticles' bubble effect: brighter toward the
  // light and shaded around the far edge, so the balloon looks round.
  const light = ctx.createRadialGradient(w * 0.35, -h * 0.45, w * 0.1, w * 0.1, -h * 0.1, w * 1.5);
  light.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
  light.addColorStop(0.4, 'rgba(255, 255, 255, 0)');
  light.addColorStop(0.75, 'rgba(0, 0, 0, 0)');
  light.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  ctx.fillStyle = light;
  ctx.fill();
  // A glossy streak along the lit shoulder, and a small glint below it.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.beginPath();
  ctx.ellipse(w * 0.45, -h * 0.42, w * 0.12, h * 0.26, 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.beginPath();
  ctx.arc(w * 0.66, -h * 0.02, w * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawDisco(ctx: CanvasRenderingContext2D, piece: Piece) {
  const { x, y, width: r } = piece;
  const fade = ctx.globalAlpha;
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, y - r);
  ctx.stroke();

  const shine = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  shine.addColorStop(0, '#f8fafc');
  shine.addColorStop(0.6, '#94a3b8');
  shine.addColorStop(1, '#334155');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Mirror tiles on the near side slide across the ball as it turns.
  for (let row = -4; row <= 4; row++) {
    const lat = (row / 5) * (Math.PI / 2);
    for (let col = 0; col < 12; col++) {
      const lon = (col * Math.PI * 2) / 12 + piece.spin;
      const facing = Math.cos(lon) * Math.cos(lat);
      if (facing <= 0) continue;
      const glint = (row + col) % 3 === 0 ? 0.85 : 0.3;
      ctx.fillStyle = `rgba(255, 255, 255, ${glint * facing})`;
      ctx.fillRect(
        x + r * Math.cos(lat) * Math.sin(lon) - 1.5 * facing,
        y + r * Math.sin(lat) - 1.5,
        3 * facing,
        3,
      );
    }
  }
  ctx.restore();

  // The specks go out as soon as the ball starts to rise.
  if (piece.age >= DISCO_REST) return;

  // Each speck is light off one facet, so it sweeps across the page as the ball turns.
  const show = clamp01((piece.age - 0.7) / 0.4);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < piece.parts; i++) {
    // Spread the facets evenly over the sphere (a Fibonacci lattice).
    const lat = Math.asin(-1 + (2 * (i + 0.5)) / piece.parts);
    const lon = i * 2.39996 + piece.spin;
    const facing = Math.cos(lon);
    if (facing <= 0) continue;
    ctx.globalAlpha = fade * show * (0.45 + 0.5 * facing);
    ctx.fillStyle = i % 3 === 0 ? (PALETTE[i % PALETTE.length] ?? '#ffffff') : '#ffffff';
    ctx.beginPath();
    ctx.ellipse(
      x + Math.sin(lon) * Math.cos(lat) * piece.reach,
      y + r + (0.55 + 0.5 * Math.sin(lat)) * piece.reach * 0.9,
      3 + 6 * facing,
      2.5 + 3.5 * facing,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, piece: Piece) {
  if (piece.age < 0) return;
  switch (piece.kind) {
    case 'paper':
      return drawPaper(ctx, piece);
    case 'ribbon':
      return drawRibbon(ctx, piece);
    case 'sparkle':
      return drawSparkle(ctx, piece);
    case 'rocket':
      return drawStreak(ctx, piece, 0.025);
    case 'ember':
      return drawStreak(ctx, piece, 0.03);
    case 'stamp':
      return drawStamp(ctx, piece);
    case 'ink':
      return drawStreak(ctx, piece, 0.03);
    case 'laser':
      return drawLaser(ctx, piece);
    case 'disco':
      return drawDisco(ctx, piece);
    case 'balloon':
      return drawBalloon(ctx, piece);
  }
}

/** Picks one enabled animation at random, or null when all of them are off. */
export function pickApprovalAnimation(
  animations: Record<ApprovalAnimation, boolean>,
): ApprovalAnimation | null {
  // Read only the animations this build knows; saved settings are shared with other difit versions.
  const enabled = (Object.keys(BURSTS) as ApprovalAnimation[]).filter(
    (animation) => animations[animation],
  );
  return enabled.length > 0 ? pick(enabled) : null;
}

/**
 * Fires one burst over the whole page from `source`, picked at random from the
 * enabled animations. The burst is not tied to a component, so re-rendering or
 * remounting the page cannot replay it; its canvas removes itself when it ends.
 */
export function celebrateApproval(
  source: Element,
  animations: Record<ApprovalAnimation, boolean>,
): void {
  const animation = pickApprovalAnimation(animations);
  if (!animation || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const ratio = window.devicePixelRatio;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'pointer-events-none fixed inset-0 z-50';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  // getContext returns null where canvas is unsupported, such as in happy-dom.
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  document.body.appendChild(canvas);

  const origin = source.getBoundingClientRect();
  const cx = origin.left + origin.width / 2;
  const cy = origin.top + origin.height / 2;
  const viewport = { width, height };
  const at = { origin, cx, cy, aim: Math.atan2(height / 2 - cy, width / 2 - cx), viewport };
  const { count, make } = BURSTS[animation];
  // In simulated seconds, like every other time in this file.
  const duration = Math.min(BURSTS[animation].duration, MAX_SECONDS * SPEED);
  // A ribbon stays until its whole body, not just its leading end, has fallen off screen.
  const isAlive = (piece: Piece) =>
    piece.life > 0 && Math.min(piece.y, ...piece.chain.map((point) => point.y)) < height + 40;
  let pieces = Array.from({ length: count }, () => make(at));
  const spawned: Piece[] = [];
  const spawn = (piece: Piece) => {
    spawned.push(piece);
  };
  let elapsed = 0;
  let pending = 0;
  let last = performance.now();
  requestAnimationFrame(function tick(now) {
    // Fixed physics steps keep the flight at a steady speed and stable when frames are dropped.
    pending += Math.min((now - last) / 1000, MAX_FRAME) * SPEED;
    last = now;
    for (; pending >= STEP; pending -= STEP) {
      elapsed += STEP;
      for (const piece of pieces) if (isAlive(piece)) step(piece, STEP, spawn);
      pieces.push(...spawned.splice(0));
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = Math.min(1, (duration - elapsed) / FADE);

    pieces = pieces.filter(isAlive);
    for (const piece of pieces) draw(ctx, piece);

    if (pieces.length > 0 && elapsed < duration) requestAnimationFrame(tick);
    else canvas.remove();
  });
}
