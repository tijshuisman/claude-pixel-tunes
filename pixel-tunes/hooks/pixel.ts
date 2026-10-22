// The scene's pixel canvas, shared by every theme: art pixels on a W×H grid,
// drawn S×S screen pixels, merged into one path per colour; and the SMIL
// helpers that animate them. Everything here is pure.

export const S = 2 // screen pixels per art pixel in the scene
export const W = 116
export const H = 64

export const BG = '#0d0221'
export const PINK = '#ff2a6d'
export const CYAN = '#00e5ff'
export const LILAC = '#9d86c9'

export const LOOP = 'repeatCount="indefinite"'

export const open = (width: number, height: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMin meet" shape-rendering="crispEdges">`

/* ── pixel frames ─────────────────────────────────────────────────────── */

export type Frame = { px: (string | undefined)[] }

export const frame = (fill?: string): Frame => ({ px: new Array<string | undefined>(W * H).fill(fill) })

export function put(f: Frame, x: number, y: number, color: string): void {
  const xi = Math.round(x)
  const yi = Math.round(y)
  if (xi >= 0 && yi >= 0 && xi < W && yi < H) f.px[yi * W + xi] = color
}

export const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}z`

/** Path data per colour, same-colour runs of a row merged into one rectangle. */
export function runs(f: Frame): Map<string, string> {
  const out = new Map<string, string>()
  for (let y = 0; y < H; y++) {
    let x = 0
    while (x < W) {
      const color = f.px[y * W + x]
      let n = 1
      while (x + n < W && f.px[y * W + x + n] === color) n++
      if (color !== undefined) out.set(color, (out.get(color) ?? '') + rect(x * S, y * S, n * S, S))
      x += n
    }
  }
  return out
}

export const fills = (byColor: Map<string, string>) =>
  [...byColor].map(([color, d]) => `<path fill="${color}" d="${d}"/>`).join('')

export const drawn = (f: Frame) => fills(runs(f))

export function add(byColor: Map<string, string>, color: string, d: string): void {
  byColor.set(color, (byColor.get(color) ?? '') + d)
}

/** Draws rows of characters, each a colour of `palette`; any other character stays clear. */
export function sprite(f: Frame, rows: readonly string[], palette: Readonly<Record<string, string>>, x: number, y: number): void {
  rows.forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      const color = palette[ch]
      if (color !== undefined) put(f, x + dx, y + dy, color)
    }),
  )
}

export function rng(seed: number): () => number {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/* ── SMIL ─────────────────────────────────────────────────────────────── */

/** Shows each frame in turn for dur/n seconds; without SMIL, frame 0 stays. */
export function cycle(frames: readonly string[], dur: number): string {
  const n = frames.length
  const keyTimes = frames.map((_, i) => (i / n).toFixed(4)).join(';')
  return frames
    .map((body, i) => {
      const values = frames.map((_, j) => (j === i ? 'visible' : 'hidden')).join(';')
      return `<g visibility="${i === 0 ? 'visible' : 'hidden'}"><animate attributeName="visibility" values="${values}" keyTimes="${keyTimes}" calcMode="discrete" dur="${dur}s" ${LOOP}/>${body}</g>`
    })
    .join('')
}

/**
 * Colour cycling, the old pixel-art trick: each pixel in a colour of `palette`
 * takes the colour before it, a step every dur/n seconds, so the colours flow
 * from each entry to the next. Other colours stay; paused, all hold.
 */
export function cyclePalette(f: Frame, palette: readonly string[], dur: number, isPlaying: boolean): string {
  if (!isPlaying) return drawn(f)
  const n = palette.length
  const keyTimes = palette.map((_, i) => (i / n).toFixed(4)).join(';')
  return [...runs(f)]
    .map(([color, d]) => {
      const i = palette.indexOf(color)
      if (i < 0) return `<path fill="${color}" d="${d}"/>`
      const values = palette.map((_, k) => palette[(i - k + n) % n]).join(';')
      return `<path fill="${color}" d="${d}"><animate attributeName="fill" values="${values}" keyTimes="${keyTimes}" calcMode="discrete" dur="${dur}s" ${LOOP}/></path>`
    })
    .join('')
}

/** Dips to `low` opacity once a period: twinkling stars, flickering windows. */
export const blink = (dur: number, begin: number, low: number) =>
  `<animate attributeName="opacity" values="1;${low};1" keyTimes="0;0.8;0.9" calcMode="discrete" dur="${dur}s" begin="${begin}s" ${LOOP}/>`

type Point = readonly [number, number]

/**
 * Snow or rain: `shape` stamped at each spot, falling the scene's height in
 * `period` seconds and `dx` pixels sideways, in `steps` jumps on the pixel
 * grid. A second copy a scene higher makes the fall loop; paused, it hangs.
 * Spots should span x from 0 to W - dx, so the sides stay filled.
 */
export function fall(
  spots: readonly Point[],
  shape: readonly Point[],
  color: string,
  { period, dx, steps, isPlaying }: { period: number; dx: number; steps: number; isPlaying: boolean },
): string {
  const stamp = (ox: number, oy: number) =>
    spots.map(([x, y]) => shape.map(([sx, sy]) => rect((x + sx + ox) * S, (y + sy + oy) * S, S, S)).join('')).join('')
  if (!isPlaying) return `<path fill="${color}" d="${stamp(0, 0)}"/>`
  const values = Array.from({ length: steps }, (_, i) => `${Math.round((i * dx) / steps) * S} ${Math.round((i * H) / steps) * S}`)
  return (
    `<g><animateTransform attributeName="transform" type="translate" values="${values.join(';')}" calcMode="discrete" dur="${period}s" ${LOOP}/>` +
    `<path fill="${color}" d="${stamp(0, 0)}${stamp(-dx, -H)}"/></g>`
  )
}

/**
 * A sideways drift: the frame slides the scene's width in `period` seconds,
 * in `steps` jumps on the pixel grid, rightwards for `dir` 1 and leftwards
 * for -1. A second copy a scene wide makes the drift loop; paused, it stands.
 */
export function drift(f: Frame, { period, steps, dir, isPlaying }: { period: number; steps: number; dir: 1 | -1; isPlaying: boolean }): string {
  const body = drawn(f)
  if (!isPlaying) return body
  const values = Array.from({ length: steps }, (_, i) => `${Math.round((i * W) / steps) * S * dir} 0`)
  return (
    `<g><animateTransform attributeName="transform" type="translate" values="${values.join(';')}" calcMode="discrete" dur="${period}s" ${LOOP}/>` +
    `${body}<g transform="translate(${-dir * W * S} 0)">${body}</g></g>`
  )
}
