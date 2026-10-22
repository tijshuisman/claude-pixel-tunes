import { H, LOOP, S, W, blink, cycle, drawn, fall, frame, put, rect, rng, sprite } from '../pixel'
import type { Frame } from '../pixel'

// City Lights: a wet street at night in an old brick city. The moon behind
// drifting clouds, brick buildings with lit windows, a fire escape and a New
// York water tower, a bar with a red neon LIVE sign, a street lamp and its
// cone of light, and everything that shines mirrored in the asphalt. While
// music plays the rain falls, the clouds drift, the neon and the windows
// flicker and the reflections shimmer.

const STREET = 50 // the curb; the asphalt below it
const WALK = 46 // the sidewalk's top

const SKY = ['#06060e', '#0a0a17', '#0f0f20', '#15142a', '#1c1a34', '#24203d', '#2e2645']
const BANDS = [0, 5, 10, 15, 19, 23, 27, WALK]

const MOON = { x: 74, y: 10, r: 5 }

type Brick = { brick: string; mortar: string; dark: string }
const RED_BRICK: Brick = { brick: '#5e2a24', mortar: '#47201c', dark: '#3a1916' }
const BROWN_BRICK: Brick = { brick: '#4f3026', mortar: '#3c241d', dark: '#2f1c17' }
const DARK_BRICK: Brick = { brick: '#3c2a33', mortar: '#2e2028', dark: '#251a21' }

const LIGHTS = ['#ffd27a', '#ffc35e', '#ffe0a0', '#8fb4ff']
const UNLIT = '#1d1620'

// The neon sign's letters, three by five.
const LIVE = [
  'r...rrr.r.r.rrr',
  'r....r..r.r.r..',
  'r....r..r.r.rr.',
  'r....r..r.r.r..',
  'rrr.rrr..r..rrr',
]

// The water tower: a conical roof, a barrel of staves in iron bands, legs.
const TOWER = [
  '.....c.....',
  '....cCc....',
  '...cCCcc...',
  '..cCCCCcc..',
  '.cCCCCCCcc.',
  'sSsSsSsSsSt',
  'bbbbbbbbbbb',
  'sSsSsSsSsSt',
  'sSsSsSsSsSt',
  'bbbbbbbbbbb',
  'sSsSsSsSsSt',
  'sSsSsSsSsSt',
  'bbbbbbbbbbb',
  '.l.x...x.l.',
  '.l..x.x..l.',
  '.l...x...l.',
  '.l..x.x..l.',
  'll.x...x.ll',
]
const TOWER_COLORS: Readonly<Record<string, string>> = {
  c: '#2b211f', C: '#3a2c27', s: '#5a3e2c', S: '#4a3224', t: '#7a5a42', b: '#1f1a1c', l: '#1b1922', x: '#25222c',
}

const LAMP = { x: 101, top: 22 }

// A yellow cab parked at the curb, facing left.
const TAXI = [
  '..........tTTt..........',
  '........yyyyyyyyy.......',
  '.......yGggyggGggy......',
  '......ygggGygggggGy.....',
  '..yyyyyyyyyyyyyyyyyyyy..',
  '.yyyyyyyyyyyyyyyyyyyyyyy',
  'HyyyyyyyyyyyyyyyyyyyyyyR',
  'YCcCcCcCcCcCcCcCcCcCcCcY',
  'YYKKKKYYYYYYYYYYYKKKKYYY',
  '..KwwK...........KwwK...',
  '..KKKK...........KKKK...',
]
const TAXI_COLORS: Readonly<Record<string, string>> = {
  t: '#2a2a30', T: '#fff3c8', g: '#2e3a58', G: '#5a6a92', y: '#f0be2c', Y: '#c2901c',
  H: '#fff6d0', R: '#ff3b3b', C: '#17151d', c: '#e6e2d6', K: '#38343e', w: '#9a9aa6',
}
const TAXI_AT = { x: 5, y: 46 }

/** Brick: courses of three rows, the third mortar, joints staggered every four. */
function bricks(f: Frame, x0: number, y0: number, x1: number, y1: number, c: Brick): void {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const course = Math.floor(y / 3)
      const isMortar = y % 3 === 2 || (x + (course % 2) * 2) % 4 === 0
      put(f, x, y, isMortar ? c.mortar : c.brick)
    }
}

/** A cornice along a roof: a dark band with a lit lip. */
function cornice(f: Frame, x0: number, x1: number, y: number, c: Brick): void {
  for (let x = x0 - 1; x <= x1; x++) {
    put(f, x, y, '#6a4a44')
    put(f, x, y + 1, c.dark)
  }
}

type Window = { x: number; y: number; w: number; h: number; color: string | null; flickers: boolean }

/** Campfire's counterpart in town: City Lights' layers, back to front. */
export function citylights(isPlaying: boolean): string[] {
  const rnd = rng(23)

  // The sky, darker above, the city's haze below.
  const sky = frame(SKY[0])
  for (let i = 0; i < 7; i++)
    for (let y = BANDS[i] ?? 0; y < (BANDS[i + 1] ?? WALK); y++)
      for (let x = 0; x < W; x++) put(sky, x, y, (i > 0 && y === BANDS[i] && (x + y) % 2 === 0 ? SKY[i - 1] : SKY[i]) ?? '#06060e')
  for (let y = MOON.y - MOON.r; y <= MOON.y + MOON.r; y++)
    for (let x = MOON.x - MOON.r; x <= MOON.x + MOON.r; x++) {
      const d = (x - MOON.x) ** 2 + (y - MOON.y) ** 2
      if (d <= MOON.r * MOON.r + 1) put(sky, x, y, d > (MOON.r - 1) ** 2 && x < MOON.x ? '#cfcab0' : (x * 7 + y * 3) % 11 === 0 ? '#d9d4ba' : '#efebd2')
    }

  // Clouds, lit from the moon at their tops; twice as wide as the sky, so their drift loops.
  const clouds = new Map<string, string>()
  const cloudFrame = frame()
  for (const [cx, cy, rx] of [[18, 7, 13], [70, 13, 16], [98, 6, 11], [44, 4, 9]] as const)
    for (let x = cx - rx; x <= cx + rx; x++) {
      const k = (x - cx) / rx
      const hump = Math.round(2.4 * Math.sqrt(Math.max(0, 1 - k * k)) + Math.sin(x * 0.8) * 0.6)
      for (let y = cy - hump; y <= cy + 1; y++) {
        const near = Math.abs(x - MOON.x) + Math.abs(y - MOON.y) < 14
        put(cloudFrame, ((x % W) + W) % W, y, y === cy - hump ? (near ? '#7a7ea6' : '#3e4166') : near ? '#3a3d62' : '#22233d')
      }
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const color = cloudFrame.px[y * W + x]
      if (color === undefined) continue
      for (const ox of [0, W]) clouds.set(color, (clouds.get(color) ?? '') + rect((x + ox) * S, y * S, S, S))
    }
  const drift = isPlaying
    ? `<animateTransform attributeName="transform" type="translate" values="${Array.from({ length: 58 }, (_, i) => `${-i * 2 * S} 0`).join(';')}" calcMode="discrete" dur="46s" ${LOOP}/>`
    : ''
  const cloudLayer = `<g>${drift}${[...clouds].map(([color, d]) => `<path fill="${color}" d="${d}"/>`).join('')}</g>`

  // The far skyline, then the buildings, the sidewalk and the street.
  const city = frame()
  for (let x = 0; x < W; ) {
    const w = 4 + Math.floor(rnd() * 6)
    const top = 13 + Math.floor(rnd() * 8)
    for (let y = top; y < WALK; y++) for (let xx = x; xx < x + w; xx++) put(city, xx, y, '#16152b')
    for (let y = top + 2; y < WALK; y += 2)
      for (let xx = x + 1; xx < x + w - 1; xx += 2) if (rnd() < 0.18) put(city, xx, y, '#6a5a4a')
    x += w + Math.floor(rnd() * 2)
  }

  const windows: Window[] = []
  const lit = (x: number, y: number, w: number, h: number, chance = 0.6) => {
    const on = rnd() < chance
    windows.push({ x, y, w, h, color: on ? (LIGHTS[Math.floor(rnd() * LIGHTS.length)] ?? '#ffd27a') : null, flickers: on && rnd() < 0.2 })
  }

  // Left: the tall red one with its fire escape.
  bricks(city, 0, 6, 26, WALK, RED_BRICK)
  cornice(city, 0, 26, 5, RED_BRICK)
  for (const y of [9, 17, 25, 33]) for (const x of [2, 8, 15, 21]) lit(x, y, 3, 4)
  // Middle: brown brick, the water tower on its roof.
  bricks(city, 26, 21, 54, WALK, BROWN_BRICK)
  cornice(city, 26, 54, 20, BROWN_BRICK)
  for (const y of [24, 32]) for (const x of [29, 35, 41, 47]) lit(x, y, 3, 4)
  sprite(city, TOWER, TOWER_COLORS, 34, 2)
  // The bar's building: low, its upper floor lit.
  bricks(city, 54, 25, 93, WALK, DARK_BRICK)
  cornice(city, 54, 93, 24, DARK_BRICK)
  for (const x of [57, 64, 71, 78, 85]) lit(x, 27, 4, 3, 0.7)
  // Right: tall again.
  bricks(city, 93, 12, W, WALK, RED_BRICK)
  cornice(city, 93, W, 11, RED_BRICK)
  for (const y of [15, 23, 31]) for (const x of [96, 103, 110]) lit(x, y, 3, 4)

  for (const w of windows)
    for (let y = w.y; y < w.y + w.h; y++)
      for (let x = w.x; x < w.x + w.w; x++) put(city, x, y, w.color && !w.flickers ? (y === w.y + w.h - 1 ? '#c98a4a' : w.color) : UNLIT)
  for (const w of windows) for (let x = w.x - 1; x <= w.x + w.w; x++) put(city, x, w.y + w.h, '#2a1c1c')

  // The fire escape: platforms with railings, ladders zigzagging between them.
  for (const y of [13, 21, 29, 37]) {
    for (let x = 13; x < 26; x++) {
      put(city, x, y, '#121018')
      if (x % 2 === 1) put(city, x, y - 1, '#121018')
      put(city, x, y - 2, '#1e1b26')
    }
    for (let k = 0; k < 7; k++) put(city, (y % 16 === 13 ? 15 : 23) + (y % 16 === 13 ? k : -k), y + 1 + k, '#1a1722')
  }

  // Street level: shops, the bar and the doors.
  for (let y = 38; y < WALK; y++) for (let x = 2; x < 22; x++) put(city, x, y, y % 2 === 0 ? '#34333f' : '#2a2934')
  for (let y = 39; y < WALK; y++) for (let x = 30; x < 35; x++) put(city, x, y, '#1a1116')
  for (let x = 29; x < 36; x++) put(city, x, 38, '#5a4038')
  for (let y = 33; y < WALK; y++) for (let x = 56; x < 92; x++) put(city, x, y, '#170e10')
  for (let y = 36; y < 45; y++)
    for (let x = 58; x < 80; x++) put(city, x, y, x % 7 === 2 ? '#3a1f14' : y < 40 ? '#ffb45a' : '#e8903e')
  // People at the bar: a head, then shoulders down to the sill.
  for (const [hx, hy] of [[61, 39], [67, 40], [75, 39]] as const) {
    for (let y = hy; y < hy + 2; y++) for (let x = hx; x < hx + 2; x++) put(city, x, y, '#4a2416')
    for (let y = hy + 2; y < 45; y++) for (let x = hx - 1; x < hx + 3; x++) put(city, x, y, '#4a2416')
  }
  for (let y = 36; y < WALK; y++) for (let x = 82; x < 88; x++) put(city, x, y, y < 41 && x > 82 && x < 87 ? '#c27a3a' : '#2a1612')
  for (let y = 38; y < WALK; y++) for (let x = 96; x < 102; x++) put(city, x, y, '#1a1116')

  // The sidewalk, the curb and the asphalt.
  for (let y = WALK; y < STREET; y++)
    for (let x = 0; x < W; x++) put(city, x, y, y === STREET - 1 ? '#4c4a60' : x % 8 === (y % 2) * 4 ? '#23222e' : '#2e2c3b')
  for (let y = STREET; y < H; y++)
    for (let x = 0; x < W; x++) put(city, x, y, y < STREET + 3 ? '#121220' : (x * 3 + y * 7) % 23 === 0 ? '#1d1d30' : '#151526')
  for (let x = 2; x < W; x += 12) for (let k = 0; k < 6; k++) put(city, x + k, 59, '#4a4430')
  sprite(city, TAXI, TAXI_COLORS, TAXI_AT.x, TAXI_AT.y)

  // Reflections in the wet asphalt: streaks under each light, the lowest light
  // nearest the curb, broken by ripples that shift while music plays.
  const streaks = (shift: number) => {
    const f = frame()
    const streak = (x: number, from: number, length: number, colors: readonly string[]) => {
      for (let k = 0; k < length; k++) {
        const y = from + k
        const step = Math.floor((k / length) * colors.length)
        // Ripples: a gap every few rows, more of them further out.
        if ((y + shift + x * 2) % (step === 0 ? 5 : 3) === 0) continue
        if (step === colors.length - 1 && (x + y) % 2 === 0) continue
        put(f, x, y, colors[step] ?? '#2c2630')
      }
    }
    for (let x = 58; x < 80; x++) if (x % 7 !== 2) streak(x, STREET + 1, 3 + ((x * 5) % 4), ['#c07a38', '#8a5428', '#5a3a26'])
    LIVE[0]?.split('').forEach((_, dx) => {
      if (LIVE.filter(row => row[dx] === 'r').length >= 3) streak(64 + dx, STREET + 4, 7 + ((dx * 3) % 4), ['#d8304a', '#9a2032', '#5a1624'])
    })
    for (let x = TAXI_AT.x + 1; x < TAXI_AT.x + 23; x++) if (x % 3 !== 0) streak(x, TAXI_AT.y + TAXI.length, 3, ['#7a6224', '#4a3c22'])
    streak(LAMP.x, STREET + 1, 12, ['#f0dc90', '#b8a66a', '#6a5e3e'])
    streak(LAMP.x + 1, STREET + 2, 8, ['#b8a66a', '#6a5e3e'])
    for (const w of windows) if (w.color && w.y > 20) streak(w.x + 1, STREET + 1, 3, ['#4a3c34', '#2c2630'])
    return drawn(f)
  }
  const ripples = [streaks(0), streaks(1), streaks(2)]

  // The neon sign: red tubes on a dark board, a glow, and their red in the street.
  const board = frame()
  for (let y = 29; y < 37; y++) for (let x = 62; x < 81; x++) put(board, x, y, y === 29 || y === 36 || x === 62 || x === 80 ? '#2a1218' : '#14080c')
  const neon = frame()
  sprite(neon, LIVE, { r: '#ff3b4f' }, 64, 30)
  const halo = frame()
  LIVE.forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      if (ch !== 'r') return
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const)
        if (LIVE[dy + oy]?.[dx + ox] !== 'r') put(halo, 64 + dx + ox, 30 + dy + oy, '#5e1424')
    }),
  )

  // The street lamp and its cone of light, with a pool below.
  const lamp = frame()
  for (let y = LAMP.top + 3; y < STREET - 1; y++) {
    put(lamp, LAMP.x, y, '#2a2d3a')
    put(lamp, LAMP.x + 1, y, '#41465a')
  }
  sprite(lamp, ['.ttt.', 'tLLLt', '.lll.', '..p..'], { t: '#2a2d3a', L: '#fff3c0', l: '#ffd97a', p: '#41465a' }, LAMP.x - 2, LAMP.top)
  put(lamp, LAMP.x - 1, STREET - 1, '#2a2d3a')
  put(lamp, LAMP.x + 2, STREET - 1, '#2a2d3a')
  let cone = ''
  for (let y = LAMP.top + 3; y < STREET + 2; y++) {
    const half = Math.round((y - LAMP.top - 2) * 0.42)
    cone += rect((LAMP.x - half) * S, y * S, (2 * half + 2) * S, S)
  }
  const pool = frame()
  for (let y = WALK; y < STREET + 4; y++)
    for (let x = LAMP.x - 10; x <= LAMP.x + 11; x++) {
      const d = ((x - LAMP.x - 0.5) / 10.5) ** 2 + ((y - STREET + 1) / 3.5) ** 2
      if (d < 1 && (d < 0.4 || (x + y) % 2 === 0)) put(pool, x, y, y < STREET ? (y === STREET - 1 ? '#6a6670' : '#46434f') : '#24223a')
    }

  // Rain, slanting left: far drops short and dim, near ones longer.
  const far = Array.from({ length: 44 }, (): [number, number] => [Math.floor(rnd() * (W + 32)), Math.floor(rnd() * H)])
  const near = Array.from({ length: 22 }, (): [number, number] => [Math.floor(rnd() * (W + 32)), Math.floor(rnd() * H)])
  const farRain = fall(far, [[0, 0], [0, 1], [-1, 2]], '#5d6a9a', { period: 1.4, dx: -32, steps: 16, isPlaying })
  const nearRain = fall(near, [[0, 0], [0, 1], [-1, 2], [-1, 3]], '#9db0e0', { period: 1, dx: -32, steps: 16, isPlaying })

  const flickering = windows.filter(w => w.flickers)
  const flicker = [frame(), frame()] as const
  flickering.forEach((w, i) => {
    for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) put(flicker[i % 2 === 0 ? 0 : 1], x, y, w.color ?? '#ffd27a')
  })
  const buzz = isPlaying
    ? `<animate attributeName="opacity" values="1;0.25;1;1;0.4;1;1;1" keyTimes="0;0.06;0.09;0.5;0.53;0.56;0.6;1" calcMode="discrete" dur="4.3s" ${LOOP}/>`
    : ''
  return [
    drawn(sky),
    cloudLayer,
    drawn(city),
    isPlaying ? `<g>${blink(6.1, -1.3, 0)}${drawn(flicker[0])}</g>` : drawn(flicker[0]),
    isPlaying ? `<g>${blink(8.3, -4.1, 0)}${drawn(flicker[1])}</g>` : drawn(flicker[1]),
    isPlaying ? cycle(ripples, 0.9) : (ripples[0] ?? ''),
    drawn(pool),
    drawn(board),
    `<g>${buzz}${drawn(halo)}${drawn(neon)}</g>`,
    drawn(lamp),
    `<path fill="#ffe9a8" opacity="0.13" d="${cone}"/>`,
    farRain,
    `<defs><clipPath id="nc-cone"><path d="${cone}"/></clipPath></defs>`,
    `<g clip-path="url(#nc-cone)">${fall(near, [[0, 0], [0, 1], [-1, 2], [-1, 3]], '#fff0c0', { period: 1, dx: -32, steps: 16, isPlaying })}</g>`,
    nearRain,
  ]
}
