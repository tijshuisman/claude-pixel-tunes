import type { Artwork, Playback, ThemeId, Track } from '../types'
import { BG, CYAN, H, LILAC, LOOP, PINK, S, W, add, fills, open, rect, rng } from './pixel'
import { THEMES } from './themes'

// Everything here is pure: playback in, SVG markup out. The markup animates
// itself with SMIL, counting from the moment its frame loads; a frame cannot
// tell the time, so `progress` gets the playback as of its drawing.
// Track names never enter the markup as text: they are drawn as pixel paths.
//
// Sized for the desktop's docked pane (about 235 px wide): the scene's art
// pixels are drawn 2×2, so they stay crisp. The pane gives each Svg these
// sizes; left to itself the desktop draws every frame 150 px tall. The cover
// is a still Svg of its own (drawn as an image, where an embedded picture is
// allowed); beside it the animated strip.

export const SIZE = {
  scene: { width: 232, height: 128 },
  cover: { width: 72, height: 72 },
  strip: { width: 160, height: 72 },
  progress: { width: 232, height: 30 },
} as const

const SHADOW = '#00a8c6'

/* ── 5×7 pixel font ───────────────────────────────────────────────────── */

// Each glyph is seven rows of five bits, the leftmost pixel the high bit.
const GLYPHS: Readonly<Record<string, readonly number[]>> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [30, 1, 1, 14, 1, 1, 30], '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8], '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], ':': [0, 4, 4, 0, 4, 4, 0], '-': [0, 0, 0, 14, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8], '&': [12, 18, 20, 8, 21, 18, 13],
  "'": [4, 4, 8, 0, 0, 0, 0], '/': [1, 2, 2, 4, 8, 8, 16], '!': [4, 4, 4, 4, 4, 0, 4],
  '?': [14, 17, 1, 2, 4, 0, 4], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8],
  '+': [0, 4, 4, 31, 4, 4, 0], '#': [10, 10, 31, 10, 31, 10, 10], '"': [10, 10, 0, 0, 0, 0, 0],
}

/** The characters the font draws: accents dropped, upper case. */
const chars = (text: string) => [...text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()]

/** Path data for `text` in the pixel font, `p` screen pixels per font pixel. */
export function glyphs(text: string, x: number, y: number, p: number): string {
  let d = ''
  chars(text).forEach((ch, i) => {
    const rows = GLYPHS[ch] ?? GLYPHS['?'] ?? []
    rows.forEach((bits, r) => {
      let c = 0
      while (c < 5) {
        if (bits & (16 >> c)) {
          let w = 0
          while (c + w < 5 && bits & (16 >> (c + w))) w++
          d += rect(x + (i * 6 + c) * p, y + r * p, w * p, p)
          c += w
        } else c++
      }
    })
  })
  return d
}

export const textWidth = (text: string, p: number) => Math.max(0, chars(text).length * 6 - 1) * p

/** A heading in the pixel font, as its own small Svg: `p` screen pixels per font pixel. */
export function pixelLabel(text: string, color: string, p = 1): { source: string; width: number; height: number } {
  const width = Math.max(1, textWidth(text, p))
  const height = 7 * p
  return { source: `${open(width, height)}<path fill="${color}" d="${glyphs(text, 0, 0, p)}"/></svg>`, width, height }
}

export function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/* ── the scene ──────────────────────────────────────────────────────── */

const scenes = new Map<string, string>()

/** The theme's scene, animated while music plays; drawn once per theme and state. */
export function scene(theme: ThemeId, isPlaying: boolean): string {
  const key = `${theme}:${isPlaying}`
  const cached = scenes.get(key)
  if (cached !== undefined) return cached

  let scanlines = ''
  for (let y = 0; y < H; y++) scanlines += rect(0, y * S + 1, W * S, 1)
  const svg = [
    open(SIZE.scene.width, SIZE.scene.height),
    ...THEMES[theme].scene(isPlaying),
    `<path fill="#000" opacity="0.22" d="${scanlines}"/>`,
    '</svg>',
  ].join('')
  scenes.set(key, svg)
  return svg
}

/* ── now playing ──────────────────────────────────────────────────────── */

const HEART_FULL = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...']
const HEART_EMPTY = ['.##.##.', '#..#..#', '#.....#', '.#...#.', '..#.#..', '...#...']
const METER = [CYAN, '#7b5cff', '#b84dff', PINK, '#ffb347']

// The cover sits at (8, 8), 56 px square: rounded 4 px and never drawn over.
const COVER = { x: 8, y: 8, size: 56 }

function picture(t: Track | null, art: Artwork | null): string {
  const { x, y, size } = COVER
  const clip = `<clipPath id="nc-cover"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="4"/></clipPath>`
  const inside = (body: string) => `<defs>${clip}</defs><g clip-path="url(#nc-cover)" shape-rendering="geometricPrecision">${body}</g>`
  if (t?.imageUrl && art?.url === t.imageUrl)
    return inside(
      `<image href="${art.dataUri}" xlink:href="${art.dataUri}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`,
    )
  if (t?.cover) {
    const [top, middle, sunColor, line] = t.cover.colors
    const [cx, cy, r] = t.cover.sun
    const k = size / 24
    return (
      `<defs><linearGradient id="nc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.62" stop-color="${middle}"/><stop offset="1" stop-color="${top}"/></linearGradient></defs>` +
      inside(
        `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="url(#nc-sky)"/>` +
          `<circle cx="${x + cx * k}" cy="${y + cy * k}" r="${r * k}" fill="${sunColor}"/>` +
          `<rect x="${x}" y="${y + 17 * k}" width="${size}" height="${7 * k}" fill="${top}" opacity="0.85"/>` +
          `<path d="M${x} ${y + 17 * k}h${size}" stroke="${line}" stroke-width="1.5"/>`,
      )
    )
  }
  // Real artwork still on its way, or nothing playing.
  return inside(`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#1a0838"/>`)
}

/** Pixel text in `room` pixels; longer text scrolls like an LED marquee. */
function label(id: string, text: string, x: number, y: number, p: number, room: number, color: string, shadow?: string): string {
  const draw = (dx: number) =>
    (shadow ? `<path fill="${shadow}" d="${glyphs(text, x + dx + p, y + p, p)}"/>` : '') +
    `<path fill="${color}" d="${glyphs(text, x + dx, y, p)}"/>`
  const width = textWidth(text, p)
  if (width <= room) return draw(0)
  const span = width + 16 * p
  const steps = Math.ceil(span / p)
  // About 16 px a second whatever the size, after a pause at the start.
  const values = [...Array.from({ length: 24 / p }, () => '0 0'), ...Array.from({ length: steps }, (_, i) => `${-(i + 1) * p} 0`)]
  return (
    `<clipPath id="${id}"><rect x="${x}" y="${y - p}" width="${room}" height="${9 * p}"/></clipPath>` +
    `<g clip-path="url(#${id})"><g>${draw(0)}${draw(span)}` +
    `<animateTransform attributeName="transform" type="translate" values="${values.join(';')}" calcMode="discrete" dur="${(values.length * 0.06 * p).toFixed(2)}s" ${LOOP}/></g></g>`
  )
}

function heart(isLiked: boolean): string {
  let d = ''
  ;(isLiked ? HEART_FULL : HEART_EMPTY).forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '#') d += rect(142 + x * 2, 10 + y * 2, 2, 2)
    }),
  )
  return `<path fill="${isLiked ? PINK : '#7d68a8'}" d="${d}"/>`
}

/** A level meter; Spotify gives no audio analysis, so it only looks the part. */
function meter(isPlaying: boolean): string {
  const bars = 8
  const levels = 5
  const leds = new Map<string, string>()
  for (let bar = 0; bar < bars; bar++)
    for (let level = 0; level < levels; level++) add(leds, METER[level] ?? CYAN, rect(110 + bar * 6, 62 - level * 3, 4, 2))
  const rnd = rng(42)
  // A cover in the background colour hides the top of each bar.
  const covers = Array.from({ length: bars }, (_, bar) => {
    const x = 110 + bar * 6
    if (!isPlaying) return `<rect x="${x}" y="50" width="4" height="12" fill="${BG}"/>`
    const heights = Array.from({ length: 14 }, () => (levels - 1 - Math.floor(rnd() * levels)) * 3)
    return `<rect x="${x}" y="50" width="4" height="${heights[0] ?? 12}" fill="${BG}"><animate attributeName="height" values="${heights.join(';')}" calcMode="discrete" dur="${(1.3 + bar * 0.17).toFixed(2)}s" ${LOOP}/></rect>`
  })
  return fills(leds) + covers.join('')
}

/** The cover in its pixel frame: a still picture, so the pane draws it as an image. */
export function coverArt(t: Track | null, art: Artwork | null): string {
  return [
    open(SIZE.cover.width, SIZE.cover.height),
    `<rect width="${SIZE.cover.width}" height="${SIZE.cover.height}" fill="${BG}"/>`,
    `<path fill="${SHADOW}" d="${rect(10, 66, 56, 2)}${rect(66, 10, 2, 56)}"/>`,
    `<path fill="${PINK}" d="${rect(8, 6, 56, 2)}${rect(8, 64, 56, 2)}${rect(6, 8, 2, 56)}${rect(64, 8, 2, 56)}"/>`,
    picture(t, art),
    '</svg>',
  ].join('')
}

/** Now playing beside the cover: title, artist, album, heart and level meter. */
export function strip(p: Playback, isLiked: boolean): string {
  const t = p.track
  return [
    open(SIZE.strip.width, SIZE.strip.height),
    `<rect width="${SIZE.strip.width}" height="${SIZE.strip.height}" fill="${BG}"/>`,
    // Nothing playing: the two words where the title and the artist go, so each fits.
    t ? label('nc-title', t.title, 2, 9, 2, 134, PINK, SHADOW) : `<path fill="${LILAC}" d="${glyphs('Nothing', 2, 9, 2)}${glyphs('playing', 2, 29, 2)}"/>`,
    t ? label('nc-artist', t.artist, 2, 29, 2, 152, CYAN) : '',
    t ? label('nc-album', t.album, 2, 52, 1, 100, LILAC) : '',
    t ? heart(isLiked) : '',
    meter(p.isPlaying),
    '</svg>',
  ].join('')
}

/* ── progress ─────────────────────────────────────────────────────────── */

const PROGRESS = [CYAN, '#3fb8ff', '#7b5cff', '#b84dff', PINK, '#ff5e5b', '#ff8c42', '#ffb347', '#ffe66d']
const SEGMENTS = 34
const SEG_X = 15
const SEG_PITCH = 6

/** The elapsed time; while playing, each digit ticks by itself. */
function clock(positionMs: number, durationMs: number, x: number, y: number, p: number, isTicking: boolean): string {
  if (!isTicking) return `<path fill="${LILAC}" d="${glyphs(fmt(positionMs), x, y, p)}"/>`
  const minuteDigits = String(Math.floor(durationMs / 60_000)).length
  // Each digit as [seconds per step, values], most significant first.
  const digits: [number, number][] = [
    ...Array.from({ length: minuteDigits }, (_, i): [number, number] => [60 * 10 ** (minuteDigits - 1 - i), 10]),
    [10, 6],
    [1, 10],
  ]
  const begin = `-${(positionMs / 1000).toFixed(2)}s`
  let out = ''
  let col = 0
  digits.forEach(([unit, count], i) => {
    if (i === minuteDigits) out += `<path fill="${LILAC}" d="${glyphs(':', x + col++ * 6 * p, y, p)}"/>`
    const keyTimes = Array.from({ length: count }, (_, j) => (j / count).toFixed(4)).join(';')
    const now = Math.floor(positionMs / 1000 / unit) % count
    for (let d = 0; d < count; d++) {
      const values = Array.from({ length: count }, (_, j) => (j === d ? 'visible' : 'hidden')).join(';')
      out +=
        `<path fill="${LILAC}" visibility="${d === now ? 'visible' : 'hidden'}" d="${glyphs(String(d), x + col * 6 * p, y, p)}">` +
        `<animate attributeName="visibility" values="${values}" keyTimes="${keyTimes}" calcMode="discrete" dur="${unit * count}s" begin="${begin}" ${LOOP}/></path>`
    }
    col++
  })
  return out
}

/** Progress: segments that fill by themselves, and the times. */
export function progress(p: Playback): string {
  const t = p.track
  const duration = Math.max(1000, t?.durationMs ?? 1000)
  const position = Math.min(duration, Math.max(0, p.positionMs))
  const done = t ? Math.floor((position / duration) * SEGMENTS) : 0
  const isTicking = p.isPlaying && t !== null && position < duration

  let dim = ''
  const lit = new Map<string, string>()
  for (let i = 0; i < SEGMENTS; i++) {
    const d = rect(SEG_X + i * SEG_PITCH, 2, 4, 6)
    dim += d
    add(lit, PROGRESS[Math.floor((i / SEGMENTS) * PROGRESS.length)] ?? PINK, d)
  }

  let grow = ''
  let head = ''
  if (isTicking) {
    const left = (duration - position) / 1000
    const boundaries = Array.from({ length: SEGMENTS - done }, (_, i) => done + 1 + i)
    const widths = [done, ...boundaries].map(k => k * SEG_PITCH)
    const keyTimes = [0, ...boundaries.map(k => ((k * duration) / SEGMENTS - position) / 1000 / left)]
      .map(v => Math.min(1, Math.max(0, v)).toFixed(4))
      .join(';')
    const timing = `keyTimes="${keyTimes}" calcMode="discrete" dur="${left.toFixed(2)}s" fill="freeze"`
    grow = `<animate attributeName="width" values="${widths.join(';')}" ${timing}/>`
    const xs = [done, ...boundaries].map(k => SEG_X + Math.min(k, SEGMENTS - 1) * SEG_PITCH)
    head =
      `<rect x="${xs[0] ?? SEG_X}" y="2" width="4" height="6" fill="#ffffff">` +
      `<animate attributeName="x" values="${xs.join(';')}" ${timing}/>` +
      `<animate attributeName="opacity" values="1;0" keyTimes="0;0.5" calcMode="discrete" dur="0.6s" ${LOOP}/></rect>`
  }

  const total = t ? fmt(duration) : '-:--'
  const right = SEG_X + SEGMENTS * SEG_PITCH - 2
  return [
    open(SIZE.progress.width, SIZE.progress.height),
    `<rect width="${SIZE.progress.width}" height="${SIZE.progress.height}" fill="${BG}"/>`,
    `<path fill="#24103f" d="${dim}"/>`,
    `<clipPath id="nc-lit"><rect x="${SEG_X}" y="0" width="${done * SEG_PITCH}" height="10">${grow}</rect></clipPath>`,
    `<g clip-path="url(#nc-lit)">${fills(lit)}</g>`,
    head,
    t ? clock(position, duration, SEG_X, 13, 2, isTicking) : `<path fill="${LILAC}" d="${glyphs('-:--', SEG_X, 13, 2)}"/>`,
    `<path fill="${LILAC}" d="${glyphs(total, right - textWidth(total, 2), 13, 2)}"/>`,
    '</svg>',
  ].join('')
}
