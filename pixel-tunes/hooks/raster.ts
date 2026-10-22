import type { ThemeId } from '../types'
import { BG, H, S, W } from './pixel'
import { THEMES } from './themes'

// The terminal draws no Svg, so there the scene is a Raster: terminal cells, each
// the upper half block in the colour of one art pixel over the colour of the one
// beneath. Its pixels come from the scene's own SVG, paused: the scenes are made of
// filled rectangles only (M, h, v, z), in groups with an opacity and, once, a clip.

/** A colour as 0xRRGGBB. */
type Rgb = number

const UPPER_HALF = 0x2580

const parseColor = (fill: string): Rgb | null => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fill.trim())?.[1]
  if (!hex) return null
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex
  return parseInt(full, 16)
}

const blend = (under: Rgb, over: Rgb, alpha: number): Rgb => {
  if (alpha >= 1) return over
  let out = 0
  for (const shift of [16, 8, 0]) {
    const a = (under >> shift) & 0xff
    const b = (over >> shift) & 0xff
    out |= Math.round(a + (b - a) * alpha) << shift
  }
  return out
}

type Box = { x0: number; y0: number; x1: number; y1: number }

/** The rectangles of a path's data, in the scene's screen pixels. */
function boxes(d: string): Box[] {
  const out: Box[] = []
  let x = 0
  let y = 0
  let points: [number, number][] = []
  const close = () => {
    if (points.length > 1) {
      const xs = points.map(p => p[0])
      const ys = points.map(p => p[1])
      out.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) })
    }
    points = []
  }
  for (const [, cmd, args] of d.matchAll(/([MhvzHVLl])([^MhvzHVLl]*)/g)) {
    const n = (args ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number)
    if (cmd === 'M') {
      close()
      x = n[0] ?? 0
      y = n[1] ?? 0
    } else if (cmd === 'h') x += n[0] ?? 0
    else if (cmd === 'v') y += n[0] ?? 0
    else if (cmd === 'H') x = n[0] ?? x
    else if (cmd === 'V') y = n[0] ?? y
    else if (cmd === 'z') {
      close()
      continue
    }
    points.push([x, y])
  }
  close()
  return out
}

const pixelCache = new Map<ThemeId, Uint32Array>()

/** The paused scene as art pixels, W × H, row-major. */
export function scenePixels(theme: ThemeId): Uint32Array {
  const cached = pixelCache.get(theme)
  if (cached) return cached

  const px = new Uint32Array(W * H).fill(parseColor(BG) ?? 0)
  const clips = new Map<string, Box[]>()
  const opacity: number[] = [1]
  const clip: (Box[] | null)[] = [null]
  let defining: string | null = null
  const svg = THEMES[theme].scene(false).join('')

  for (const [, closing, tag, attrs, selfClosed] of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs ?? '')?.[1]
    if (tag === 'g') {
      if (closing) {
        opacity.pop()
        clip.pop()
      } else if (!selfClosed) {
        opacity.push((opacity.at(-1) ?? 1) * Number(attr('opacity') ?? 1))
        const url = /url\(#([^)]+)\)/.exec(attr('clip-path') ?? '')?.[1]
        clip.push(url ? (clips.get(url) ?? []) : (clip.at(-1) ?? null))
      }
    } else if (tag === 'clipPath') {
      defining = closing ? null : (attr('id') ?? null)
      if (defining) clips.set(defining, [])
    } else if (tag === 'path' && !closing) {
      const d = attr('d') ?? ''
      if (defining) {
        clips.get(defining)?.push(...boxes(d))
        continue
      }
      const color = parseColor(attr('fill') ?? '')
      if (color === null) continue
      const alpha = (opacity.at(-1) ?? 1) * Number(attr('opacity') ?? 1)
      const inside = clip.at(-1) ?? null
      for (const b of boxes(d)) {
        // Screen pixels to art pixels: each art pixel is S × S, sampled at its top left.
        for (let ay = Math.ceil(b.y0 / S); ay * S < b.y1 && ay < H; ay++)
          for (let ax = Math.ceil(b.x0 / S); ax * S < b.x1 && ax < W; ax++) {
            if (ax < 0 || ay < 0) continue
            const sx = ax * S
            const sy = ay * S
            if (inside && !inside.some(c => sx >= c.x0 && sx < c.x1 && sy >= c.y0 && sy < c.y1)) continue
            const i = ay * W + ax
            px[i] = blend(px[i] ?? 0, color, alpha)
          }
      }
    }
  }
  pixelCache.set(theme, px)
  return px
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? '=' : B64[(n >> 6) & 63]!) + (c === undefined ? '=' : B64[n & 63]!)
  }
  return out
}

/**
 * The paused scene as Raster cells at most `columns` wide: one art pixel across a
 * cell, two down it. A narrower pane gets the middle of the scene, where it happens.
 */
export function sceneCells(theme: ThemeId, columns: number): { columns: number; rows: number; cells: string } {
  const px = scenePixels(theme)
  const width = Math.max(1, Math.min(W, columns))
  const left = Math.floor((W - width) / 2)
  const rows = H / 2
  const words = new Uint32Array(width * rows * 3)
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < width; col++) {
      const k = (row * width + col) * 3
      words[k] = UPPER_HALF
      words[k + 1] = px[2 * row * W + left + col] ?? 0
      words[k + 2] = px[(2 * row + 1) * W + left + col] ?? 0
    }
  // Little-endian u32s, as the Raster reads them.
  const bytes = new Uint8Array(words.length * 4)
  words.forEach((w, i) => {
    bytes[i * 4] = w & 0xff
    bytes[i * 4 + 1] = (w >>> 8) & 0xff
    bytes[i * 4 + 2] = (w >>> 16) & 0xff
    bytes[i * 4 + 3] = (w >>> 24) & 0xff
  })
  return { columns: width, rows, cells: base64(bytes) }
}
