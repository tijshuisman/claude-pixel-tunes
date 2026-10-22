import { H, LOOP, W, blink, cycle, drawn, drift, frame, put } from '../pixel'
import type { Frame } from '../pixel'

// Dance Floor: a club at night. A mirror ball hangs over a floor of glass
// tiles, a DJ stands at the decks between two stacks of speakers, and lasers
// fan out from the booth. While music plays the ball turns and its specks of
// light sweep the walls, the floor lights up anew on every beat, the lasers
// sweep, the speakers pump and the DJ dances; paused, the room holds still.

const FLOOR = 41 // the dance floor's back edge
const BEAT = 0.5 // seconds a beat, at 120 bpm

const WALL = ['#04020a', '#07030f', '#0a0514', '#0e071a', '#120920', '#170b27']
const BANDS = [0, 7, 14, 21, 28, 35, FLOOR]

// The floor: rows of tiles between seams, their side seams running to a vanishing point.
const SEAMS = [FLOOR, 44, 48, 53, 59]
const VANISH = { x: 58, y: 6 }
const TILE = 0.3 // a tile's width, as the slope between its side seams
const GLASS = [
  { lit: '#ff3ea5', top: '#ff9bd0', dim: '#3d1233' },
  { lit: '#2de2e6', top: '#a8f6f7', dim: '#0d3442' },
  { lit: '#ffd23f', top: '#fff0a6', dim: '#3d3112' },
  { lit: '#7dff5a', top: '#cbffbb', dim: '#173d17' },
  { lit: '#b06cff', top: '#dcc0ff', dim: '#28164a' },
]

const BALL = { x: 58, y: 11, r: 7.5 }
const MIRROR = ['#1f2238', '#383d5c', '#5a6186', '#8a91b8', '#bfc5e3', '#eef0ff']
const FACET = Math.PI / 8

const CABINET = { body: '#15111d', edge: '#2a2436', dark: '#07050b', surround: '#2c2638', cap: '#3b3449', pump: '#4a4262' }
const STACKS = [3, W - 17] // each stack's left column, 14 wide

const BOOTH = { x0: 36, x1: 79, top: 32 }
const GLOW = ['#3a1756', '#2c1145', '#1f0c34'] // the stage light on the wall behind the booth, inside out
const LEDS = ['#ff3ea5', '#2de2e6', '#ffd23f']

// Two lasers on the booth's corners, each fanning out three beams that sweep.
const LASERS = [
  { x: BOOTH.x0, color: '#4dff6e', angles: [104, 128, 152], sweep: [0, 6, 12, 6] },
  { x: BOOTH.x1, color: '#ff4fd8', angles: [76, 52, 28], sweep: [0, -6, -12, -6] },
]

/** A number in [0, 1) that depends only on its arguments. */
function hash(a: number, b: number, c: number): number {
  let h = Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** A filled circle around (cx, cy). */
function disc(f: Frame, cx: number, cy: number, r: number, color: string): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) put(f, x, y, color)
}

/** A filled rectangle, both corners included. */
function box(f: Frame, x0: number, y0: number, x1: number, y1: number, color: string): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(f, x, y, color)
}

/** The floor's tile under a pixel, by column and row; undefined on a seam. */
function tileAt(x: number, y: number): { i: number; j: number; isTop: boolean } | undefined {
  let j = -1
  SEAMS.forEach((seam, k) => {
    if (seam <= y) j = k
  })
  if (j < 0 || SEAMS[j] === y) return undefined
  const depth = y + 0.5 - VANISH.y
  const i = Math.floor((x - VANISH.x) / depth / TILE + 0.5)
  if (Math.floor((x + 1 - VANISH.x) / depth / TILE + 0.5) !== i) return undefined
  return { i, j, isTop: y === (SEAMS[j] ?? 0) + 1 }
}

/** A tile's glass, the same on every beat. */
const glass = (i: number, j: number) => GLASS[Math.floor(hash(i, j, 0) * GLASS.length)] ?? { lit: '#ff3ea5', top: '#ff9bd0', dim: '#3d1233' }

/** The mirror ball, turned by `phase`: facets in a checker, lit from the upper left. */
function ball(f: Frame, phase: number): void {
  const { x: cx, y: cy, r } = BALL
  for (let y = Math.floor(cy - r); y < cy + r; y++)
    for (let x = Math.floor(cx - r); x < cx + r; x++) {
      const nx = (x + 0.5 - cx) / r
      const ny = (y + 0.5 - cy) / r
      const d = nx * nx + ny * ny
      if (d > 1) continue
      const nz = Math.sqrt(1 - d)
      const lon = Math.atan2(nx, nz) - phase
      const lat = Math.asin(ny)
      const checker = (Math.floor(lon / FACET) + Math.floor(lat / FACET)) % 2 === 0 ? 1 : 0
      const light = -0.45 * nx - 0.5 * ny + 0.74 * nz
      const level = Math.max(0, Math.min(MIRROR.length - 1, Math.round(light * 4 + checker * 1.2 - 0.3)))
      put(f, x, y, MIRROR[level] ?? '#5a6186')
    }
}

/** A stack of two cabinets: a horn and a mid on top, a woofer below. */
function stack(f: Frame, x0: number): void {
  for (let y = 17; y < FLOOR; y++)
    for (let x = x0; x < x0 + 14; x++) {
      const isEdge = x === x0 || x === x0 + 13 || y === 17 || y === 27 || y === 28 || y === FLOOR - 1
      put(f, x, y, isEdge ? CABINET.edge : CABINET.body)
    }
  box(f, x0 + 2, 19, x0 + 11, 21, CABINET.dark)
  for (let x = x0 + 2; x <= x0 + 11; x++) put(f, x, 19, CABINET.edge)
  disc(f, x0 + 7, 24.5, 2, CABINET.dark)
  disc(f, x0 + 7, 34.5, 5.2, CABINET.surround)
  disc(f, x0 + 7, 34.5, 4.2, CABINET.dark)
  disc(f, x0 + 7, 34.5, 1.5, CABINET.cap)
}

/** The DJ in headphones, nodding `nod` pixels down, the right fist raised or on the deck; lit from above. */
function dj(f: Frame, nod: number, isFistUp: boolean): void {
  const body = frame()
  const ink = '#07040c'
  box(body, 56, 20 + nod, 59, 20 + nod, ink) // head
  box(body, 55, 21 + nod, 60, 24 + nod, ink)
  box(body, 56, 25 + nod, 59, 25 + nod, ink)
  box(body, 53, 26, 62, 26, ink) // shoulders
  box(body, 52, 27, 63, 31, ink) // torso, down behind the decks
  for (const [x, y] of [[51, 29], [51, 30], [50, 30], [50, 31]] as const) put(body, x, y, ink)
  const arm: readonly (readonly [number, number])[] = isFistUp
    ? [[63, 25], [64, 25], [64, 24], [65, 24], [65, 23], [65, 22], [66, 22], [66, 21], [66, 20], [67, 20], [66, 19], [67, 19], [66, 18], [67, 18]]
    : [[64, 29], [64, 30], [65, 30], [65, 31]]
  for (const [x, y] of arm) put(body, x, y, ink)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (body.px[y * W + x] !== undefined) put(f, x, y, y > 0 && body.px[(y - 1) * W + x] === undefined ? '#4b3a78' : ink)
  // The headphones: a band over the head, a cup on each ear with a light.
  box(f, 55, 19 + nod, 60, 19 + nod, '#2e2740')
  for (const x of [54, 61]) {
    box(f, x, 21 + nod, x, 23 + nod, '#2e2740')
    put(f, x, 22 + nod, '#ff3ea5')
  }
}

/** One laser beam from (x0, y0) at `angle` degrees, until it leaves the scene. */
function beam(f: Frame, x0: number, y0: number, angle: number, color: string): void {
  const dx = Math.cos((angle * Math.PI) / 180)
  const dy = -Math.sin((angle * Math.PI) / 180)
  for (let t = 3; t < 200; t += 0.4) {
    const x = x0 + dx * t
    const y = y0 + dy * t
    if (x < -1 || x > W || y < -1) return
    put(f, x, y, color)
  }
}

/** Dance Floor's layers, back to front. */
export function dancefloor(isPlaying: boolean): string[] {
  // The back wall, dark above, a little lighter towards the floor; the truss and its spots.
  const back = frame(WALL[0])
  for (let i = 0; i < WALL.length; i++)
    for (let y = BANDS[i] ?? 0; y < (BANDS[i + 1] ?? FLOOR); y++)
      for (let x = 0; x < W; x++) put(back, x, y, (i > 0 && y === BANDS[i] && (x + y) % 2 === 0 ? WALL[i - 1] : WALL[i]) ?? '#04020a')
  for (let x = 0; x < W; x++) {
    put(back, x, 0, '#262033')
    put(back, x, 1, x % 4 === 0 || x % 4 === 2 ? '#1a1624' : x % 4 === 1 ? '#262033' : '#0c0a12')
    put(back, x, 2, '#262033')
  }
  for (const [x, lens] of [[12, '#ff3ea5'], [30, '#2de2e6'], [84, '#ffd23f'], [102, '#b06cff']] as const) {
    box(back, x, 3, x + 1, 4, '#1a1622')
    box(back, x, 5, x + 1, 5, lens)
  }
  for (const x0 of STACKS) stack(back, x0)

  // The floor: dim glass tiles, a trim along the back.
  for (let y = FLOOR; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = tileAt(x, y)
      put(back, x, y, y === FLOOR ? '#2a1f3d' : t ? glass(t.i, t.j).dim : '#06030c')
    }

  // The stage light on the wall behind the booth, dithered at its edges.
  const glow = frame()
  for (let y = 3; y < FLOOR; y++)
    for (let x = 0; x < W; x++) {
      const k = Math.sqrt(((x + 0.5 - 58) / 34) ** 2 + ((y + 0.5 - 30) / 19) ** 2) * GLOW.length
      let ring = Math.floor(k)
      if (k - ring > 0.6 && (x + y) % 2 === 0) ring++
      const color = GLOW[ring]
      if (color !== undefined) put(glow, x, y, color)
    }

  // Specks of light from the ball, swept round the walls.
  const specks = frame()
  for (let n = 0; n < 30; n++) {
    const x = Math.floor(hash(n, 1, 7) * W)
    const y = 4 + Math.floor(hash(n, 2, 7) * 26)
    const color = n % 5 === 0 ? '#ffc2ec' : n % 7 === 0 ? '#b8f4ff' : '#f4f2ff'
    put(specks, x, y, color)
    if (n % 3 === 0) put(specks, x + 1, y, color)
  }

  // The speakers' woofers, pushed out on the beat.
  const pumps = [true, false].map(isOut => {
    const f = frame()
    if (isOut)
      for (const x0 of STACKS) {
        disc(f, x0 + 7, 34.5, 3.2, CABINET.pump)
        disc(f, x0 + 7, 34.5, 2.2, CABINET.dark)
        disc(f, x0 + 7, 34.5, 1.8, CABINET.cap)
      }
    return drawn(f)
  })

  // The DJ, on the beat: up, down, up, down with a raised fist.
  const djs = ([[0, false], [1, false], [0, false], [1, true]] as const).map(([nod, isFistUp]) => {
    const f = frame()
    dj(f, nod, isFistUp)
    return drawn(f)
  })

  // The booth: decks and a mixer on a table, LEDs along its front, a laser on each corner.
  const booth = frame()
  box(booth, BOOTH.x0, BOOTH.top, BOOTH.x1, FLOOR - 1, '#100c18')
  box(booth, BOOTH.x0, BOOTH.top, BOOTH.x1, BOOTH.top, '#3a3050')
  box(booth, BOOTH.x0 + 2, BOOTH.top + 3, BOOTH.x1 - 2, FLOOR - 2, '#0a0711')
  for (const x0 of [39, 66]) {
    box(booth, x0, 30, x0 + 10, 31, '#1d1828')
    box(booth, x0 + 2, 30, x0 + 7, 30, '#2c2540')
    put(booth, x0 + (x0 < 58 ? 9 : 1), 30, '#ff3ea5')
  }
  box(booth, 52, 29, 63, 31, '#1d1828')
  for (const [x0, x1] of [[BOOTH.x0, BOOTH.x0 + 1], [BOOTH.x1 - 1, BOOTH.x1]] as const) {
    box(booth, x0, 29, x1, 31, '#1a1622')
    box(booth, x0, 29, x1, 29, '#3a3050')
  }
  const leds = [...Array(20).keys()].map(n => ({ x: BOOTH.x0 + 3 + n * 2, color: LEDS[n % LEDS.length] ?? '#ff3ea5' }))
  for (const led of leds) put(booth, led.x, 37, '#2a1f3d')
  const chase = [0, 1, 2].map(k => {
    const f = frame()
    leds.forEach((led, n) => {
      if ((n + k) % 3 === 0) put(f, led.x, 37, led.color)
    })
    return drawn(f)
  })
  // The mixer's meters, bouncing.
  const meters = [[3, 2, 2, 3], [2, 3, 3, 1], [3, 1, 2, 2], [1, 2, 3, 2]].map(levels => {
    const f = frame()
    levels.forEach((level, n) => {
      const x = [54, 56, 59, 61][n] ?? 54
      for (let h = 0; h < level; h++) put(f, x, 31 - h, h === 0 ? '#7dff5a' : h === 1 ? '#ffd23f' : '#ff3b4f')
    })
    return drawn(f)
  })

  // The floor lights up: a new pattern of tiles on every beat.
  const tiles = [0, 1, 2, 3].map(k => {
    const f = frame()
    for (let y = FLOOR + 1; y < H; y++)
      for (let x = 0; x < W; x++) {
        const t = tileAt(x, y)
        if (!t || hash(t.i, t.j, k + 1) >= 0.4) continue
        const g = glass(t.i, t.j)
        put(f, x, y, t.isTop && t.j > 0 ? g.top : g.lit)
      }
    return drawn(f)
  })

  // The lasers' beams, sweeping out and back.
  const beams = [0, 1, 2, 3].map(k => {
    const f = frame()
    for (const l of LASERS) for (const a of l.angles) beam(f, l.x, 29, a + (l.sweep[k] ?? 0), l.color)
    return drawn(f)
  })

  // The ball on its cord, turning half a facet a frame.
  const cord = frame()
  for (let y = 3; y < BALL.y - BALL.r; y++) put(cord, BALL.x - 1, y, '#3a3550')
  const balls = [0, 1, 2, 3].map(k => {
    const f = frame()
    ball(f, (k * FACET) / 2)
    return drawn(f)
  })
  // A sparkle on the ball's lit rim.
  const glint = frame()
  for (let d = -3; d <= 3; d++) {
    const color = d === 0 ? '#ffffff' : Math.abs(d) === 1 ? '#e4e8ff' : Math.abs(d) === 2 ? '#aab4f0' : '#5c64a8'
    put(glint, 51 + d, 7, color)
    put(glint, 51, 7 + d, color)
  }

  const pulse = isPlaying ? `<animate attributeName="opacity" values="1;0.75" keyTimes="0;0.4" calcMode="discrete" dur="${BEAT}s" ${LOOP}/>` : ''
  return [
    drawn(back),
    `<g>${pulse}${drawn(glow)}</g>`,
    drift(specks, { period: 23.2, steps: W, dir: -1, isPlaying }),
    isPlaying ? cycle(pumps, BEAT) : (pumps[1] ?? ''),
    isPlaying ? cycle(djs, 4 * BEAT) : (djs[0] ?? ''),
    drawn(booth),
    isPlaying ? cycle(chase, 0.6) : (chase[0] ?? ''),
    isPlaying ? cycle(meters, 4 * BEAT) : (meters[0] ?? ''),
    isPlaying ? cycle(tiles, 4 * BEAT) : (tiles[0] ?? ''),
    `<g opacity="0.85">${isPlaying ? cycle(beams, 4 * BEAT) : (beams[0] ?? '')}</g>`,
    drawn(cord),
    isPlaying ? cycle(balls, 1.2) : (balls[0] ?? ''),
    isPlaying ? `<g>${blink(1.3, 0, 0)}${drawn(glint)}</g>` : drawn(glint),
  ]
}
