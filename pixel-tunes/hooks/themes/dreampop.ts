import { H, LOOP, W, blink, cycle, drawn, drift, frame, put, rng } from '../pixel'
import type { Frame } from '../pixel'

// Dream Pop: a still lake at night. A full moon hangs low over dark hills, an
// aurora wavers across the sky and the water mirrors it all; mist lies along
// the shore and over the water, reeds stand in front. While music plays the
// aurora drifts and breathes, the mist drifts and the moonlight on the water
// glitters; the stars twinkle always.

const HZ = 35 // the shoreline, water below
const TAU = Math.PI * 2

const SKY = ['#060a22', '#0a0f2c', '#10153a', '#181b46', '#221f50', '#2f2559', '#432d66', '#5a3673']
const BANDS = [0, 4, 8, 12, 16, 20, 25, 30, HZ]
const STARS = ['#ffffff', '#d9e6ff', '#ffe9f6']
const MOON = { x: 82, y: 18, r: 6.5 }
const CRATERS = [[-2, -2, 1.6], [2, 1, 1.3], [-1, 3, 1], [3, -3, 0.9]] as const // offset from the moon's centre, radius
const AURORA = ['#b8ffe0', '#82efc8', '#62c8d2', '#7a96dc', '#a98be0', '#ee9fd6'] // from its foot up
const WATER = '#080c26' // what reflections fade towards

type Hills = { top: number; phase: number; color: string; rim: string }
const FAR_HILLS: Hills = { top: 27, phase: 0.8, color: '#2a2858', rim: '#47417c' }
const NEAR_HILLS: Hills = { top: 31, phase: 3.1, color: '#10112a', rim: '#1e1e40' }
const PINES = [5, 9, 22, 26, 31, 46, 60, 64, 95, 100, 108]

// Reeds by the corners: column, top, lean at the top.
const REEDS = [[2, 49, 0], [4, 53, 1], [6, 47, 0], [8, 55, -1], [11, 51, 0], [13, 57, 1], [104, 56, -1], [107, 50, 0], [109, 54, 1], [112, 48, 0], [114, 52, -1]] as const

/** Blends hex colour `a` towards `b` by `t`. */
function mix(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16)
  const cb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => Math.round(((ca >> shift) & 255) * (1 - t) + ((cb >> shift) & 255) * t)
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

/** A wave along the scene that repeats every scene width, so a drift of it loops. */
const wave = (x: number, times: number, phase: number) => Math.sin((TAU * x * times) / W + phase)

/** A ridge's top row in column x. */
const ridge = (x: number, h: Hills) => Math.round(h.top + 2.4 * wave(x, 2, h.phase) + 1.3 * wave(x, 5, h.phase * 2))

/** Both ridges, lit along the top by the moon, and pines along the near one. */
function hills(f: Frame): void {
  for (const h of [FAR_HILLS, NEAR_HILLS])
    for (let x = 0; x < W; x++) {
      const top = ridge(x, h)
      for (let y = top; y < HZ; y++) put(f, x, y, y === top ? h.rim : h.color)
    }
  for (const x of PINES) {
    const top = ridge(x, NEAR_HILLS)
    for (let k = 0; k < 7; k++) for (let dx = -Math.floor(k / 2); dx <= Math.floor(k / 2); dx++) put(f, x + dx, top - 6 + k, NEAR_HILLS.color)
  }
}

/** The full moon with its craters, lit brightest along its upper left, in a dithered halo. */
function moon(f: Frame): void {
  for (let y = MOON.y - 11; y <= MOON.y + 11; y++)
    for (let x = MOON.x - 11; x <= MOON.x + 11; x++) {
      const d = Math.sqrt((x + 0.5 - MOON.x) ** 2 + (y + 0.5 - MOON.y) ** 2)
      if (d <= MOON.r) {
        const isCrater = CRATERS.some(([cx, cy, r]) => (x + 0.5 - MOON.x - cx) ** 2 + (y + 0.5 - MOON.y - cy) ** 2 < r * r)
        put(f, x, y, isCrater ? '#ded6bc' : d > MOON.r - 1 && x + y < MOON.x + MOON.y ? '#fffbe9' : '#f4eed6')
      } else if (d <= MOON.r + 2.5 && (d <= MOON.r + 1.5 || (x + y) % 2 === 0)) put(f, x, y, '#3a3a74')
      else if (d <= MOON.r + 4.5 && (x + y) % 2 === 0) put(f, x, y, '#2c2c62')
    }
}

/** A band of mist along row `cy`, thicker and thinner along the way. */
function mist(f: Frame, cy: number, phase: number, core: string, edge: string): void {
  for (let x = 0; x < W; x++) {
    const top = Math.round(cy + 1.2 * wave(x, 2, phase))
    const bottom = Math.round(cy + 1.2 * wave(x, 2, phase) + 2.4 + 1.4 * wave(x, 3, phase * 2))
    for (let y = top; y <= bottom; y++) put(f, x, y, y === top || y === bottom ? edge : core)
  }
}

/** Dream Pop's layers, back to front. */
export function dreampop(isPlaying: boolean): string[] {
  const rnd = rng(17)

  // The sky in dithered bands and the stars.
  const back = frame(SKY[0])
  for (let i = 0; i < SKY.length; i++)
    for (let y = BANDS[i] ?? 0; y < (BANDS[i + 1] ?? HZ); y++)
      for (let x = 0; x < W; x++) put(back, x, y, (i > 0 && y === BANDS[i] && (x + y) % 2 === 0 ? SKY[i - 1] : SKY[i]) ?? '#060a22')
  const stars = Array.from({ length: 38 }, (_, i) => ({
    x: Math.floor(rnd() * W),
    y: Math.floor(rnd() * 26),
    color: STARS[i % 3] ?? '#ffffff',
    twinkles: rnd() < 0.4,
  })).filter(s => (s.x - MOON.x) ** 2 + (s.y - MOON.y) ** 2 > 140)
  for (const s of stars) if (!s.twinkles) put(back, s.x, s.y, s.color)
  const twinkle = [frame(), frame()] as const
  stars.filter(s => s.twinkles).forEach((s, i) => put(twinkle[i % 2 === 0 ? 0 : 1], s.x, s.y, s.color))

  // The moon behind the hills. The lake mirrors the sky and the hills without
  // the moon, darker towards you: the moon's light on the water comes below.
  const moonless: Frame = { px: back.px.slice() }
  moon(back)
  hills(back)
  hills(moonless)
  for (let y = HZ; y < H; y++)
    for (let x = 0; x < W; x++)
      put(back, x, y, mix(moonless.px[(2 * HZ - 1 - y) * W + x] ?? '#060a22', WATER, 0.25 + ((y - HZ) / (H - HZ)) * 0.25))
  for (let n = 0; n < 34; n++) {
    const x = Math.floor(rnd() * W)
    const y = HZ + 2 + Math.floor(rnd() * (H - HZ - 2))
    const length = 2 + Math.floor(rnd() * 5)
    for (let k = 0; k < length; k++) put(back, x + k, y, y < 48 ? '#2b2e60' : '#22264f')
  }
  for (let x = 0; x < W; x++) put(back, x, HZ, '#2a2a58')

  // The moonlight on the water: a path of glints, wider towards you, glittering.
  const glade = [0, 1, 2].map(k => {
    const f = frame()
    const glitter = rng(31 + k)
    for (let y = HZ + 1; y < H; y++) {
      const half = 1.5 + (y - HZ) * 0.28
      for (let x = Math.round(MOON.x - half - glitter() * 2); x <= Math.round(MOON.x + half); ) {
        const length = 1 + Math.floor(glitter() * 3)
        for (let n = 0; n < length; n++) {
          const off = Math.abs(x + n + 0.5 - MOON.x) / half
          put(f, x + n, y, off < 0.3 ? '#f2ead0' : off < 0.65 ? '#aaa59c' : '#5f5f88')
        }
        x += length + 2 + Math.floor(glitter() * 3)
      }
    }
    return drawn(f)
  })

  // The aurora: curtains of light from a wavering foot, their tops ragged; and their mirror in the lake.
  const aurora = frame()
  const mirrored = frame()
  for (let x = 0; x < W; x++) {
    const foot = Math.round(12 + 2.5 * wave(x, 2, 0.6) + 1.2 * wave(x, 5, 1.7))
    // Its curtains swell and thin along the way.
    const height = (7 + 2.5 * wave(x, 3, 0.2) + 1.5 * wave(x, 7, 2.4) + 1.2 * wave(x, 17, 0.9)) * (0.6 + 0.4 * wave(x, 1, 2))
    for (let y = foot - Math.ceil(height * 1.15); y <= foot; y++) {
      const up = (foot - y) / height
      const color = up < 0.12 ? AURORA[0] : up < 0.3 ? AURORA[1] : up < 0.55 ? AURORA[2] : up < 0.8 ? AURORA[3] : up <= 1 ? AURORA[4] : height > 7 ? AURORA[5] : undefined
      if (color === undefined || y < 0) continue
      put(aurora, x, y, color)
      put(mirrored, x, 2 * HZ - 1 - y, color)
    }
  }
  const breathe = (low: number, high: number) =>
    isPlaying ? `<animate attributeName="opacity" values="${low};${high};${low + 0.05};${high - 0.05};${low}" dur="13s" ${LOOP}/>` : ''

  // Mist along the shore and over the water.
  const shore = frame()
  mist(shore, 31, 0.4, '#b9b3e6', '#8d87c2')
  const low = frame()
  mist(low, 41, 2.2, '#a9a3da', '#7f79b6')

  // Reeds in the corners, black against the water, a cattail on the taller ones.
  const reeds = frame()
  for (const [x, top, lean] of REEDS) {
    for (let y = top; y < H; y++) put(reeds, x + Math.round(((H - y) / (H - top)) * lean), y, '#05060f')
    if (top < 52) for (let y = top + 1; y < top + 4; y++) for (const dx of [0, 1]) put(reeds, x + lean + dx, y, '#1a1018')
  }

  return [
    drawn(back),
    `<g>${blink(3.9, 0, 0.2)}${drawn(twinkle[0])}</g>`,
    `<g>${blink(5.7, -2.3, 0.2)}${drawn(twinkle[1])}</g>`,
    `<g opacity="0.85">${breathe(0.7, 1)}${drift(aurora, { period: 116, steps: W, dir: -1, isPlaying })}</g>`,
    `<g opacity="0.26">${breathe(0.2, 0.32)}${drift(mirrored, { period: 116, steps: W, dir: -1, isPlaying })}</g>`,
    isPlaying ? cycle(glade, 2.1) : (glade[0] ?? ''),
    `<g opacity="0.22">${drift(shore, { period: 92, steps: W, dir: 1, isPlaying })}</g>`,
    `<g opacity="0.14">${drift(low, { period: 140, steps: W, dir: -1, isPlaying })}</g>`,
    drawn(reeds),
  ]
}
