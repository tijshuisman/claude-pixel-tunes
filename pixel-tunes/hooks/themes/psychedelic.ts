import { H, W, blink, cycle, cyclePalette, drawn, frame, put, rng } from '../pixel'
import type { Frame } from '../pixel'

// Psychedelic: a desert at sunset, as on a seventies poster. A huge sun
// sinks on the horizon in rings of colour, rays turning around it, mesas
// stand dark against a sky that runs from violet to orange, and the sand lies
// in waves of colour. While music plays the rays turn, the sun's rings flow
// outwards and the waves of sand flow towards you; the stars twinkle always.

const HZ = 38 // the horizon's row
const SUN = { x: 58, y: HZ, r: 15 }

const SKY = ['#1a0533', '#2b0844', '#410c55', '#5c1262', '#7c1a69', '#a0256c', '#c4346a', '#e44d64']
const BANDS = [0, 5, 10, 15, 20, 25, 29, 33, HZ]
const STARS = ['#ffffff', '#ffd6f0', '#c8f0ff']
const RINGS = ['#fff6b0', '#ffe066', '#ffbe4d', '#ff9442', '#ff6a50', '#f2476e'] // inside out
const SAND = ['#ffcf6b', '#ffa04d', '#ff6f59', '#e8467a', '#a9358a', '#6b2f8f'] // far to near

const RAYS = 12 // around the whole circle
const TURNS = 5 // frames a ray takes to reach the next one's place

type Mesa = { x0: number; x1: number; top: number }
const MESAS: readonly Mesa[] = [
  { x0: 3, x1: 27, top: 26 },
  { x0: 33, x1: 37, top: 32 },
  { x0: 81, x1: 84, top: 33 },
  { x0: 90, x1: 112, top: 28 },
]
const ROCK = { body: '#33093f', stripe: '#2a0735', rim: '#ff7a8a', lit: '#a0306e' }

// A saguaro against the light.
const SAGUARO = [
  '....kk....',
  '...kkkk...',
  '...kkkk...',
  'k..kkkk...',
  'kk.kkkk..k',
  'kk.kkkk.kk',
  'kk.kkkk.kk',
  'kkkkkkk.kk',
  '.kkkkkkkkk',
  '...kkkkkk.',
  '...kkkk...',
  '...kkkk...',
  '...kkkk...',
  '...kkkk...',
]

/** A mesa: a flat top with a notch here and there, steep sides down to the horizon, lit along its top and the side facing the sun. */
function mesa(f: Frame, m: Mesa): void {
  const facesRight = m.x1 < SUN.x
  for (let x = m.x0 - 5; x <= m.x1 + 5; x++) {
    const out = x < m.x0 ? m.x0 - x : x > m.x1 ? x - m.x1 : 0
    const top = m.top + out * 2 + (out === 0 && (x * 7) % 5 === 0 ? 1 : 0)
    for (let y = top; y < HZ; y++) {
      const isRim = y === top
      const isLitSide = facesRight ? x >= m.x1 : x <= m.x0
      put(f, x, y, isRim ? (isLitSide || out === 0 ? ROCK.rim : ROCK.lit) : isLitSide && y < top + 3 ? ROCK.lit : x % 4 === 0 ? ROCK.stripe : ROCK.body)
    }
  }
}

/** A silhouette against the light, rimmed along its top and the side facing the sun. */
function backlit(f: Frame, rows: readonly string[], x0: number, y0: number, rim: string, body: string): void {
  const towardSun = x0 < SUN.x ? 1 : -1
  rows.forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      if (ch !== 'k') return
      const isEdge = row[dx + towardSun] !== 'k' || rows[dy - 1]?.[dx] !== 'k'
      put(f, x0 + dx, y0 + dy, isEdge ? rim : body)
    }),
  )
}

/** Psychedelic's layers, back to front. */
export function psychedelic(isPlaying: boolean): string[] {
  const rnd = rng(5)

  // The sky in dithered bands, stars in its darkest part.
  const back = frame(SKY[0])
  for (let i = 0; i < SKY.length; i++)
    for (let y = BANDS[i] ?? 0; y < (BANDS[i + 1] ?? HZ); y++)
      for (let x = 0; x < W; x++) put(back, x, y, (i > 0 && y === BANDS[i] && (x + y) % 2 === 0 ? SKY[i - 1] : SKY[i]) ?? '#1a0533')
  const stars = Array.from({ length: 22 }, (_, i) => ({
    x: Math.floor(rnd() * W),
    y: Math.floor(rnd() * 13),
    color: STARS[i % 3] ?? '#ffffff',
    twinkles: rnd() < 0.5,
  }))
  for (const s of stars) if (!s.twinkles) put(back, s.x, s.y, s.color)
  const twinkle = [frame(), frame()] as const
  stars.filter(s => s.twinkles).forEach((s, i) => put(twinkle[i % 2 === 0 ? 0 : 1], s.x, s.y, s.color))

  // The rays: every other wedge around the sun, a shade lighter; they turn a little each frame.
  const wedge = 360 / RAYS
  const rays = Array.from({ length: TURNS }, (_, k) => {
    const f = frame()
    for (let y = 0; y < HZ; y++)
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - SUN.x
        const dy = SUN.y - y - 0.5
        if (dx * dx + dy * dy <= (SUN.r + 1) ** 2) continue
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI - (k * wedge) / TURNS
        if ((((angle % wedge) + wedge) % wedge) < wedge / 2) put(f, x, y, '#ffe2b8')
      }
    return drawn(f)
  })

  // The sun in rings, above the horizon.
  const sun = frame()
  for (let y = SUN.y - SUN.r; y < HZ; y++)
    for (let x = SUN.x - SUN.r; x < SUN.x + SUN.r; x++) {
      const d = Math.sqrt((x + 0.5 - SUN.x) ** 2 + (y + 0.5 - SUN.y) ** 2)
      const ring = RINGS[Math.floor((d / SUN.r) * RINGS.length)]
      if (ring !== undefined) put(sun, x, y, ring)
    }

  // Mesas on the horizon, and the desert in waves of colour, wider towards you.
  const rocks = frame()
  for (const m of MESAS) mesa(rocks, m)
  const sand = frame()
  for (let y = HZ; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = y - HZ
      const t = Math.sqrt(d + 0.5) * 2.4 + Math.sin(x * 0.1 + Math.sqrt(d) * 1.4) * (0.15 + d * 0.035)
      put(sand, x, y, SAND[Math.floor(t) % SAND.length] ?? '#ffa04d')
    }

  // Saguaros, one near and one further off.
  const cacti = frame()
  backlit(cacti, SAGUARO, 9, 47, '#ff8a6a', '#2c0a38')
  backlit(cacti, SAGUARO.slice(0, 11), 101, 41, '#ff8a6a', '#2c0a38')

  return [
    drawn(back),
    `<g>${blink(3.7, 0, 0.2)}${drawn(twinkle[0])}</g>`,
    `<g>${blink(5.3, -2.1, 0.2)}${drawn(twinkle[1])}</g>`,
    `<g opacity="0.16">${isPlaying ? cycle(rays, 1.5) : (rays[0] ?? '')}</g>`,
    cyclePalette(sun, RINGS, 1.8, isPlaying),
    drawn(rocks),
    cyclePalette(sand, SAND, 2.4, isPlaying),
    drawn(cacti),
  ]
}
