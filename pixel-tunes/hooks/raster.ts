import type { ThemeId } from '../types'
import { BG, H, S, W } from './pixel'
import { THEMES } from './themes'

// The terminal draws no Svg, so there the scene is drawn from the scene's own SVG
// by this module: as a Raster of terminal cells, each the upper half block in the
// colour of one art pixel over the colour of the one beneath, or as a picture for a
// terminal that draws them. The scenes are made of filled rectangles only (M, h, v,
// z), in groups with an opacity and, once, a clip; while music plays, SMIL animates
// them: opacity, visibility and fill in steps or gliding, and translations. A scene
// is read into a tree once, and that tree is worked out at any moment.

/** A colour as 0xRRGGBB. */
type Rgb = number

const UPPER_HALF = 0x2580

const parseColor = (fill: string | undefined): Rgb | null => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((fill ?? '').trim())?.[1]
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
  for (const [, cmd, args] of d.matchAll(/([MhvzHV])([^MhvzHV]*)/g)) {
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

/* ── the scene as a tree ──────────────────────────────────────────────── */

type Anim = {
  name: string
  values: string[]
  keyTimes: number[] | null
  isDiscrete: boolean
  dur: number
  begin: number
}

type Node = {
  tag: string
  attrs: Record<string, string>
  children: Node[]
  anims: Anim[]
  rects: Box[]
}

const seconds = (text: string | undefined) => {
  const m = /^(-?[\d.]+)(ms|s)?$/.exec((text ?? '0').trim())
  if (!m) return 0
  return Number(m[1]) / (m[2] === 'ms' ? 1000 : 1)
}

function parse(svg: string): { root: Node; clips: Map<string, Box[]> } {
  const root: Node = { tag: 'svg', attrs: {}, children: [], anims: [], rects: [] }
  const clips = new Map<string, Box[]>()
  const stack: Node[] = [root]
  let clipId: string | null = null
  for (const [, closing, tag = '', body = '', selfClosed] of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    if (closing) {
      if (tag === 'clipPath') clipId = null
      else if (tag === 'g' || tag === 'path') stack.pop()
      continue
    }
    const attrs: Record<string, string> = {}
    for (const [, name = '', value = ''] of body.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) attrs[name] = value
    const parent = stack.at(-1) ?? root
    if (tag === 'clipPath') {
      clipId = attrs.id ?? null
      if (clipId) clips.set(clipId, [])
    } else if (tag === 'animate' || tag === 'animateTransform') {
      parent.anims.push({
        name: attrs.attributeName ?? '',
        values: (attrs.values ?? '').split(';').map(v => v.trim()),
        keyTimes: attrs.keyTimes ? attrs.keyTimes.split(';').map(Number) : null,
        isDiscrete: attrs.calcMode === 'discrete',
        dur: seconds(attrs.dur) || 1,
        begin: seconds(attrs.begin),
      })
    } else if (tag === 'path') {
      if (clipId) clips.get(clipId)?.push(...boxes(attrs.d ?? ''))
      else {
        const node: Node = { tag, attrs, children: [], anims: [], rects: boxes(attrs.d ?? '') }
        parent.children.push(node)
        if (!selfClosed) stack.push(node)
      }
    } else if (tag === 'g') {
      const node: Node = { tag, attrs, children: [], anims: [], rects: [] }
      parent.children.push(node)
      if (!selfClosed) stack.push(node)
    }
  }
  return { root, clips }
}

/** What an animation sets at `t` seconds, or undefined before it begins. */
function valueAt(a: Anim, t: number): string | number | undefined {
  const local = t - a.begin
  if (local < 0 || a.values.length === 0) return undefined
  const frac = (local % a.dur) / a.dur
  const n = a.values.length
  if (a.isDiscrete) {
    let i = Math.min(n - 1, Math.floor(frac * n))
    if (a.keyTimes) {
      i = 0
      a.keyTimes.forEach((k, j) => {
        if (k <= frac) i = j
      })
    }
    return a.values[Math.min(i, n - 1)]
  }
  // Gliding: numbers only (opacity), evenly or at the key times.
  const times = a.keyTimes ?? a.values.map((_, j) => (n === 1 ? 0 : j / (n - 1)))
  let j = 0
  while (j < n - 2 && frac >= (times[j + 1] ?? 1)) j++
  const t0 = times[j] ?? 0
  const t1 = times[j + 1] ?? 1
  const v0 = Number(a.values[j])
  const v1 = Number(a.values[j + 1] ?? a.values[j])
  return t1 > t0 ? v0 + (v1 - v0) * Math.min(1, (frac - t0) / (t1 - t0)) : v0
}

const trees = new Map<string, { root: Node; clips: Map<string, Box[]> }>()

function tree(theme: ThemeId, isPlaying: boolean) {
  const key = `${theme}:${isPlaying}`
  let found = trees.get(key)
  if (!found) {
    found = parse(THEMES[theme].scene(isPlaying).join(''))
    trees.set(key, found)
  }
  return found
}

/** The scene as art pixels, W × H, row-major: paused, or playing at `t` seconds. */
export function scenePixels(theme: ThemeId, isPlaying = false, t = 0): Uint32Array {
  const { root, clips } = tree(theme, isPlaying)
  const px = new Uint32Array(W * H).fill(parseColor(BG) ?? 0)

  const paint = (node: Node, alpha: number, dx: number, dy: number, clip: Box[] | null, fill: string | undefined) => {
    let a = alpha * Number(node.attrs.opacity ?? 1)
    let x = dx
    let y = dy
    let color = node.attrs.fill ?? fill
    for (const anim of isPlaying ? node.anims : []) {
      const v = valueAt(anim, t)
      if (v === undefined) continue
      if (anim.name === 'visibility' && v === 'hidden') return
      if (anim.name === 'opacity') a = alpha * Number(v)
      if (anim.name === 'fill') color = String(v)
      if (anim.name === 'transform') {
        const [tx = 0, ty = 0] = String(v).split(/[\s,]+/).map(Number)
        x += tx
        y += ty
      }
    }
    if (a <= 0) return
    const url = /url\(#([^)]+)\)/.exec(node.attrs['clip-path'] ?? '')?.[1]
    const inside = url ? (clips.get(url) ?? []) : clip
    if (node.tag === 'path') {
      const rgb = parseColor(color)
      if (rgb !== null)
        for (const b of node.rects) {
          // Screen pixels to art pixels: each art pixel is S × S, sampled at its top left.
          const x0 = b.x0 + x
          const y0 = b.y0 + y
          const x1 = b.x1 + x
          const y1 = b.y1 + y
          for (let ay = Math.max(0, Math.ceil(y0 / S)); ay * S < y1 && ay < H; ay++)
            for (let ax = Math.max(0, Math.ceil(x0 / S)); ax * S < x1 && ax < W; ax++) {
              const sx = ax * S
              const sy = ay * S
              if (inside && !inside.some(c => sx >= c.x0 && sx < c.x1 && sy >= c.y0 && sy < c.y1)) continue
              const i = ay * W + ax
              px[i] = blend(px[i] ?? 0, rgb, a)
            }
        }
    }
    for (const child of node.children) paint(child, a, x, y, inside, node.tag === 'g' ? color : fill)
  }

  paint(root, 1, 0, 0, null, undefined)
  return px
}

/* ── for the terminal ─────────────────────────────────────────────────── */

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
 * The scene as Raster cells at most `columns` wide: one art pixel across a cell,
 * two down it. A narrower pane gets the middle of the scene, where it happens.
 */
export function sceneCells(theme: ThemeId, columns: number, isPlaying = false, t = 0): { columns: number; rows: number; cells: string } {
  const px = scenePixels(theme, isPlaying, t)
  const width = Math.max(1, Math.min(W, columns))
  const left = Math.floor((W - width) / 2)
  const rows = H / 2
  const bytes = new Uint8Array(width * rows * 12)
  const view = new DataView(bytes.buffer)
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < width; col++) {
      // Little-endian u32s, as the Raster reads them.
      const k = (row * width + col) * 12
      view.setUint32(k, UPPER_HALF, true)
      view.setUint32(k + 4, px[2 * row * W + left + col] ?? 0, true)
      view.setUint32(k + 8, px[(2 * row + 1) * W + left + col] ?? 0, true)
    }
  return { columns: width, rows, cells: base64(bytes) }
}

/** How many screen pixels an art pixel gets in the terminal's picture, so the terminal hardly has to blur it up. */
export const IMAGE_SCALE = 6

/* A PNG of our own: the mod has no zlib. Rows repeat and pixels come in runs, so
   with the Up and Sub filters they turn into runs of zeros, which deflate stores as
   matches at distance 1 under the fixed Huffman codes: small enough to send a
   picture several times a second. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]

function deflate(data: Uint8Array): Uint8Array {
  const out: number[] = []
  let bits = 0
  let count = 0
  const put = (value: number, n: number) => {
    bits |= value << count
    count += n
    while (count >= 8) {
      out.push(bits & 0xff)
      bits >>>= 8
      count -= 8
    }
  }
  // A Huffman code goes out with its highest bit first.
  const code = (value: number, n: number) => {
    let reversed = 0
    for (let i = 0; i < n; i++) reversed |= ((value >> i) & 1) << (n - 1 - i)
    put(reversed, n)
  }
  const literal = (b: number) => (b < 144 ? code(0x30 + b, 8) : code(0x190 + b - 144, 9))
  const lengthSymbol = (sym: number) => (sym < 280 ? code(sym - 256, 7) : code(0xc0 + sym - 280, 8))
  const match = (length: number) => {
    let i = LENGTH_BASE.length - 1
    while ((LENGTH_BASE[i] ?? 0) > length) i--
    lengthSymbol(257 + i)
    if (LENGTH_EXTRA[i]) put(length - (LENGTH_BASE[i] ?? 0), LENGTH_EXTRA[i] ?? 0)
    code(0, 5) // distance 1
  }

  put(1, 1) // the last block
  put(1, 2) // fixed Huffman codes
  let i = 0
  while (i < data.length) {
    const b = data[i] ?? 0
    literal(b)
    let run = 0
    while (i + 1 + run < data.length && data[i + 1 + run] === b) run++
    i += 1 + run
    while (run >= 3) {
      const length = Math.min(258, run)
      // Leave no tail of 1 or 2 behind a match: those go out as literals below.
      const take = run - length > 0 && run - length < 3 ? length - 3 : length
      match(take)
      run -= take
    }
    while (run-- > 0) literal(b)
  }
  lengthSymbol(256)
  if (count > 0) out.push(bits & 0xff)
  return Uint8Array.from(out)
}

function zlib(data: Uint8Array): Uint8Array {
  let a = 1
  let b = 0
  for (const byte of data) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  const body = deflate(data)
  const out = new Uint8Array(body.length + 6)
  out[0] = 0x78
  out[1] = 0x01
  out.set(body, 2)
  new DataView(out.buffer).setUint32(body.length + 2, ((b << 16) | a) >>> 0)
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)))
  return out
}

/** Art pixels as a PNG, each a hard-edged square of `scale` pixels. */
function png(px: Uint32Array, scale: number): Uint8Array {
  const width = W * scale
  const height = H * scale
  const stride = width * 3 + 1
  const raw = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const row = y * stride
    if (y % scale !== 0) {
      raw[row] = 2 // Up: the same as the row above, so all zeros
      continue
    }
    raw[row] = 1 // Sub: each byte less the one three before it
    let prev = 0
    for (let x = 0; x < width; x++) {
      const color = px[Math.floor(y / scale) * W + Math.floor(x / scale)] ?? 0
      const k = row + 1 + x * 3
      raw[k] = (((color >> 16) & 0xff) - ((prev >> 16) & 0xff)) & 0xff
      raw[k + 1] = (((color >> 8) & 0xff) - ((prev >> 8) & 0xff)) & 0xff
      raw[k + 2] = ((color & 0xff) - (prev & 0xff)) & 0xff
      prev = color
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8 // bits per channel
  header[9] = 2 // RGB
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', header), chunk('IDAT', zlib(raw)), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const stillImages = new Map<ThemeId, string>()

/** The scene as a PNG for a terminal that draws pictures: paused (kept), or playing at `t` seconds. */
export function sceneImage(theme: ThemeId, isPlaying = false, t = 0): { png: string } {
  if (isPlaying) return { png: base64(png(scenePixels(theme, true, t), IMAGE_SCALE)) }
  let still = stillImages.get(theme)
  if (still === undefined) {
    still = base64(png(scenePixels(theme), IMAGE_SCALE))
    stillImages.set(theme, still)
  }
  return { png: still }
}
