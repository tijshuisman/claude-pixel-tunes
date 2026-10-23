import { H, W, cycle, drawn, frame, put, sprite } from '../pixel'
import type { Frame } from '../pixel'

// Flat Eric, for Mr. Oizo: the yellow puppet up close, in the gilded room of
// the old Levi's ads. He sits on the bed by a bowl of sausages, one in his
// mouth and held in his paw, and nods calmly to the beat while the speaker
// beside him pumps; paused, he holds still, sausage and all.

const BEAT = 0.5 // seconds a beat, at 120 bpm

type Felt = { light: string; base: string; shade: string; deep: string; edge: string; fuzz: string }

const FUR: Felt = { light: '#fde26a', base: '#f5c823', shade: '#e0a51c', deep: '#bf7f14', edge: '#9a6a10', fuzz: '#e0a51c' }
const SNOUT: Felt = { light: '#ffffff', base: '#f4f1ea', shade: '#dcd5c6', deep: '#c2b9a6', edge: '#e6dfcf', fuzz: '#f4f1ea' }
const SAUSAGE = { light: '#f7a777', base: '#e2784a', shade: '#b4532c', edge: '#7a3218' }
const WALL = { base: '#8c9f96', light: '#9aaca3', dark: '#6c8077', low: '#5f7269' }
const GOLD = { light: '#f0d784', base: '#c9a24a', dark: '#7d5f22' }

const HEAD = { x: 40, y: 25, rx: 16, ry: 19 }
const BODY = { x: 40, y: 72, r: 31 }

type Shape = (x: number, y: number) => boolean

/** A number in [0, 1) that depends only on its arguments. */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** A filled rectangle, both corners included. */
function box(f: Frame, x0: number, y0: number, x1: number, y1: number, color: string): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(f, x, y, color)
}

/**
 * Felt over `inside`, shaded by `shade` (-1 lit, 0, 1, 2 deep), its flecks
 * moving `dy` down with it, and a hair sticking out of its edge here and there.
 */
function felt(f: Frame, inside: Shape, shade: (x: number, y: number) => number, dy: number, colors: Felt): void {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const isNear = inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)
      if (!inside(x, y)) {
        if (isNear && hash(x, y - dy, 3) < 0.18) put(f, x, y, colors.fuzz)
        continue
      }
      const isEdge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)
      const n = hash(x, y - dy, 1)
      const s = shade(x, y) + (n < 0.06 ? 1 : n > 0.95 ? -1 : 0)
      put(f, x, y, isEdge ? colors.edge : s >= 2 ? colors.deep : s >= 1 ? colors.shade : s <= -1 ? colors.light : colors.base)
    }
}

/** A rod `r` thick from (ax, ay) to (bx, by), lit on its left: a sausage or an arm. */
function rod(f: Frame, ax: number, ay: number, bx: number, by: number, r: number, colors: { light: string; base: string; shade: string; edge: string }): void {
  const vx = bx - ax
  const vy = by - ay
  const l2 = vx * vx + vy * vy
  for (let y = Math.floor(Math.min(ay, by) - r); y <= Math.max(ay, by) + r; y++)
    for (let x = Math.floor(Math.min(ax, bx) - r); x <= Math.max(ax, bx) + r; x++) {
      const px = x + 0.5 - ax
      const py = y + 0.5 - ay
      const t = Math.max(0, Math.min(1, (px * vx + py * vy) / l2))
      const dx = px - t * vx
      const dy = py - t * vy
      const d = Math.hypot(dx, dy)
      if (d > r) continue
      const side = (dx * vy - dy * vx) / Math.sqrt(l2)
      put(f, x, y, d > r - 0.9 ? colors.edge : side < -r / 3 ? colors.light : side > r / 3 ? colors.shade : colors.base)
    }
}

/** A wall panel in a gilded frame, lit from the upper left, a curl in each corner. */
function panel(f: Frame, x0: number, y0: number, x1: number, y1: number): void {
  for (let x = x0; x <= x1; x++) {
    put(f, x, y0, GOLD.light)
    put(f, x, y1, GOLD.dark)
    put(f, x, y0 + 1, WALL.dark)
  }
  for (let y = y0; y <= y1; y++) {
    put(f, x0, y, GOLD.light)
    put(f, x1, y, GOLD.dark)
    put(f, x0 + 1, y, WALL.dark)
  }
  box(f, x0 + 2, y0 + 2, x1 - 1, y1 - 1, WALL.light)
  for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const)
    for (const [dx, dy] of [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [2, 3]] as const) put(f, cx + sx * dx, cy + sy * dy, GOLD.base)
}

// The cartouche over the right-hand panel: a shell between two scrolls.
const CARTOUCHE = [
  '....g.lll.g....',
  '..gg.lgggl.gg..',
  '.g..gglglgg..g.',
  'g.g..dgggd..g.g',
  '.gg...ddd...gg.',
]

/** The room behind Eric: panelled wall, the bed's satin pillow, and his body. */
function room(): Frame {
  const f = frame(WALL.base)
  panel(f, 3, 7, 63, 43)
  panel(f, 69, 7, 113, 43)
  sprite(f, CARTOUCHE, { g: GOLD.base, l: GOLD.light, d: GOLD.dark }, 84, 2)
  for (let x = 0; x < W; x++) {
    put(f, x, 46, GOLD.light)
    put(f, x, 47, GOLD.dark)
  }
  box(f, 0, 48, W - 1, H - 1, WALL.low)

  // The satin pillow on the bed, a fold across it.
  const pillow: Shape = (x, y) => Math.abs((x + 0.5 - 4) / 13) ** 4 + Math.abs((y + 0.5 - 40) / 15) ** 4 <= 1
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!pillow(x, y)) continue
      const isFold = Math.abs(y - 34 - (x - 4) * 0.4) < 0.8 || Math.abs(y - 46 + (x - 4) * 0.3) < 0.8
      put(f, x, y, !pillow(x + 1, y) || !pillow(x, y + 1) ? '#a9b3ae' : isFold ? '#c9d0cc' : x + y < 40 ? '#ffffff' : '#eceeed')
    }

  felt(
    f,
    (x, y) => y >= 40 && (x + 0.5 - BODY.x) ** 2 + (y + 0.5 - BODY.y) ** 2 <= BODY.r * BODY.r,
    x => (x > 52 ? 1 : x < 26 ? -1 : 0),
    0,
    FUR,
  )
  return f
}

// The tuft on his head; its top two rows lag behind the nod.
const TUFT = ['.......ll..', '.....lll..l', '..l.lbl.ll.', '...bbbbbb..']
const EYE = ['.kk.', 'khkk', 'kkkk', '.kk.']
const NOSE = ['hkkk.', 'kkkkk', '.kkk.']

/** Eric: his head `nod` pixels down, its tuft `flick` behind, the sausage in his mouth and paw. */
function eric(f: Frame, nod: number, flick: number): void {
  const cy = HEAD.y + nod
  felt(
    f,
    (x, y) => {
      // Broader at the jaw than at the flat top.
      const v = (y + 0.5 - cy) / HEAD.ry
      return Math.abs((x + 0.5 - HEAD.x) / (HEAD.rx + v * 3)) ** 2.6 + Math.abs(v) ** 2.6 <= 1
    },
    (x, y) => {
      const s = ((x + 0.5 - HEAD.x) / HEAD.rx) * 0.6 + ((y + 0.5 - cy) / HEAD.ry) * 0.8
      return s > 0.85 ? 2 : s > 0.45 ? 1 : s < -0.55 ? -1 : 0
    },
    nod,
    FUR,
  )
  const fur = { l: FUR.light, b: FUR.base }
  sprite(f, TUFT.slice(0, 2), fur, 34, 2 + nod + flick)
  sprite(f, TUFT.slice(2), fur, 34, 4 + nod)

  // The white snout: narrow under the eyes, wider down to the nose, round the mouth.
  felt(
    f,
    (x, y) => {
      const dx = Math.abs(x + 0.5 - 40)
      const dy = y + 0.5 - nod
      return (dx <= 5 + (dy - 17) * 0.8 && (dx / 13) ** 2 + ((dy - 29) / 11.5) ** 2 <= 1) || (dx / 14.5) ** 2 + ((dy - 34) / 6) ** 2 <= 1
    },
    (x, y) => (x > 47 || y > 37 + nod ? 1 : 0),
    nod,
    SNOUT,
  )
  for (const x of [32, 45]) sprite(f, EYE, { k: '#14100c', h: '#b9b4aa' }, x, 11 + nod)
  sprite(f, NOSE, { k: '#1b1714', h: '#6d6863' }, 38, 23 + nod)

  // The mouth, open: dark under the snout, red, the tongue lighter below.
  for (let y = 29 + nod; y <= 36 + nod; y++)
    for (let x = 29; x <= 53; x++) {
      const k = ((x + 0.5 - 41) / 11) ** 2 + ((y + 0.5 - 29 - nod) / 7) ** 2
      if (k > 1) continue
      const depth = y - 29 - nod
      put(f, x, y, k > 0.78 ? '#5c120a' : depth < 2 ? '#7a1a10' : depth < 4 ? '#c9341f' : '#e2563a')
    }

  // His arm comes up from below; the sausage runs from his mouth past his paw.
  rod(f, 36, 51 + nod, 14, 66, 4.5, FUR)
  rod(f, 40, 31 + nod, 28, 63 + nod, 3, SAUSAGE)
  felt(
    f,
    (x, y) => ((x + 0.5 - 35) / 5) ** 2 + ((y + 0.5 - 49 - nod) / 5) ** 2 <= 1,
    x => (x > 37 ? 1 : 0),
    nod,
    FUR,
  )
  // His fingers, curled round the sausage.
  for (const y of [47, 49, 51]) for (const x of [30, 31, 32, 33]) put(f, x, y + nod, FUR.edge)
}

/** The speaker on the right: a black dome of mesh, a ring wider when it pumps. */
function speaker(f: Frame, isOut: boolean): void {
  const cx = 112
  const cy = 30
  const r = isOut ? 13 : 12
  for (let y = cy - r - 1; y <= cy + r; y++)
    for (let x = cx - r - 1; x < W; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const d = Math.hypot(dx, dy)
      if (d > r) continue
      const isRim = d > r - 1.5 && dx + dy < 0
      put(f, x, y, isRim ? '#4e4e56' : x % 2 === 0 && y % 2 === 0 ? '#38383e' : '#17171a')
    }
  box(f, cx - 7, cy - 7, cx - 6, cy - 7, '#8a8a94')
}

/** In front: the orange bowl of sausages, and the table's dark green top. */
function front(): Frame {
  const f = frame()
  for (const [ax, bx, by] of [[76, 70, 37], [82, 80, 33], [88, 91, 35], [93, 100, 40]] as const) rod(f, ax, 51, bx, by, 2.5, SAUSAGE)
  for (let y = 49; y <= 60; y++) {
    const half = 15 - ((y - 49) / 11) ** 2 * 4
    for (let x = Math.round(84 - half); x <= Math.round(84 + half); x++) {
      const u = (x - 84) / half
      put(f, x, y, y === 49 ? '#ffa860' : u < -0.6 ? '#ff9a4a' : u > 0.45 ? '#c0561a' : '#e8701e')
    }
  }
  box(f, 0, 60, W - 1, 60, '#2f5744')
  box(f, 0, 61, W - 1, H - 1, '#1e3b2e')
  return f
}

/** Flat Eric's layers, back to front. */
export function flateric(isPlaying: boolean): string[] {
  // On the beat: up, down, all the way down, back up; the tuft flicks behind.
  const erics = ([[0, 0], [1, -1], [2, 0], [1, 1]] as const).map(([nod, flick]) => {
    const f = frame()
    eric(f, nod, flick)
    return drawn(f)
  })
  const speakers = [false, false, true, false].map(isOut => {
    const f = frame()
    speaker(f, isOut)
    return drawn(f)
  })
  return [
    drawn(room()),
    isPlaying ? cycle(speakers, BEAT) : (speakers[0] ?? ''),
    isPlaying ? cycle(erics, BEAT) : (erics[0] ?? ''),
    drawn(front()),
  ]
}
