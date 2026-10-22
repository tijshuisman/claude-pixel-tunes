import { H, LOOP, W, blink, cycle, drawn, fall, frame, put, rng, sprite } from '../pixel'
import type { Frame } from '../pixel'

// Campfire: a winter night in the mountains. Stars and a crescent moon over
// snowy peaks, a row of pines, a log cabin with a warm window and smoke from
// its chimney, a campfire with its glow on the snow. While music plays the
// fire burns, sparks and smoke rise, the window flickers softly and snow
// falls; the stars twinkle always.

const HZ = 40 // where the snowfield meets the trees

const SKY = ['#03071a', '#060c23', '#09122d', '#0d1838', '#121f44', '#18284f', '#20315b']
const BANDS = [0, 5, 10, 15, 20, 25, 30, HZ]
const STARS = ['#ffffff', '#cfe0ff', '#fff1c4']

type Peak = { x: number; top: number; slope: number }
type Range = { lit: string; shade: string; snow: string; snowShade: string; depth: number }

const FAR_PEAKS: readonly Peak[] = [
  { x: -4, top: 18, slope: 0.7 },
  { x: 56, top: 13, slope: 0.62 },
  { x: 93, top: 18, slope: 0.72 },
]
const NEAR_PEAKS: readonly Peak[] = [
  { x: -6, top: 24, slope: 1.1 },
  { x: 47, top: 18, slope: 1 },
  { x: 80, top: 16, slope: 0.95 },
  { x: 112, top: 21, slope: 1.05 },
]
const FAR: Range = { lit: '#1d2a55', shade: '#18234a', snow: '#8193c4', snowShade: '#5f70a3', depth: 7 }
const NEAR: Range = { lit: '#22305e', shade: '#192450', snow: '#e3eaf8', snowShade: '#9fafd6', depth: 6 }

type Pine = { trunk: string; dark: string; lit: string; snow: string; snowShade: string }
const FAR_PINE: Pine = { trunk: '#121a33', dark: '#14223f', lit: '#182a48', snow: '#7d8fbe', snowShade: '#5d6e9e' }
const NEAR_PINE: Pine = { trunk: '#2a1a14', dark: '#0d2a2c', lit: '#123634', snow: '#dfe8f7', snowShade: '#9aabd3' }

const SNOW = ['#5a6a9d', '#6575a9', '#7080b4', '#7a8abd', '#8494c5'] // far to near
const SNOW_ROWS = [HZ, 43, 47, 52, 58, H]
const SNOW_DRIFT = { body: '#8a9acb', lit: '#b3c1e6', shade: '#62729f', glint: '#d6e0f6' }

const FIRE = { x: 80, y: 53 } // the flames' foot
const GLOW = ['#f2b77e', '#dba98a', '#bf9c98', '#a191aa'] // inside out

// The cabin's wall of logs, its window and door; the gable roof is drawn.
const WALL = [
  'ellllllllllllllllllllllle',
  'ELLLLLLLLLLLLLLLLLLLLLLLE',
  'elllffffffflllllllllllle.',
  'ELLLfwwhwwfLLLLLdDdDdLLLE',
  'elllfwwhwwflllllDdDdDllle',
  'ELLLfhhhhhfLLLLLdDdDdLLLE',
  'elllfoohoofllllldDdkdlll.',
  'ELLLfoohoofLLLLLdDdDdLLLE',
  'elllfffffffllllldDdDdllle',
  'ELLssssssssLLLLLdDdDdLLLE',
  'ellllllllllllllldDdDdllle',
  'ELLLLLLLLLLLLLLLdDdDdLLLE',
  'cCcCcCcCcCcCcCcCcCcCcCcCc',
]
const CABIN_COLORS: Readonly<Record<string, string>> = {
  e: '#8b5a35', E: '#5e3820', l: '#6e4126', L: '#4e2c19', f: '#2a160c',
  w: '#ffd27a', h: '#ffeab0', o: '#ffb347', d: '#3f2416', D: '#55321e', k: '#d9b25a',
  s: '#e9f0fb', c: '#3c3f55', C: '#2c2e42',
}
const WALL_AT = { x: 7, y: 31 }
const ROOF = { cx: 19, top: 23, rows: 8 } // the peak is columns cx and cx + 1
const ROOF_COLORS = { snow: '#eef3fc', snowShade: '#aebde2', board: '#2e1a10', gable: '#5a3520', gableDark: '#4c2b19', icicle: '#cfe0ff' }

// Logs stacked by the cabin's wall, ends out.
const WOODPILE = [
  '.sssss..',
  'sSeeSes.',
  'ereerere',
  'eeeereee',
  'reereree',
]
const WOODPILE_COLORS: Readonly<Record<string, string>> = { s: '#e9f0fb', S: '#aebde2', e: '#b07a4a', r: '#6e4126' }

// Four frames of flames, tips to foot.
const FLAMES = [
  [
    '......R......',
    '......r...R..',
    '.....ro...r..',
    '..R..roo.ro..',
    '..r.rooor.o..',
    '..roooyyoroo.',
    '.rooyyyyyoor.',
    '.roooyywyyor.',
    'rooyyywwwyoor',
    'royyywwwwyyor',
    'royywwwwwwyor',
    '.oyywwwwwwyo.',
  ],
  [
    '....R........',
    '....r.....R..',
    '...or....ro..',
    '...oor..roo..',
    '..rooor.ooR..',
    '.rooyyooyor..',
    '.rooyyyyyoorR',
    'rooyyywyyyor.',
    'rooyywwwwyoor',
    'royywwwwwyyor',
    'royywwwwwwyor',
    '.oyywwwwwwyo.',
  ],
  [
    '........R....',
    '...R....r....',
    '...r...ro..R.',
    '...ro..roo.r.',
    '..rooorooo.r.',
    '..rooyyyooor.',
    '.rooyyyyyyor.',
    '.roooyywyyoor',
    'rooyywwwyyyor',
    'royywwwwwyyor',
    'royywwwwwwyor',
    '.oyywwwwwwyo.',
  ],
  [
    '.....R.......',
    '.R...r...R...',
    '.r..ro...r...',
    '.ro.roo.ro...',
    '..roooorooor.',
    '..rooyyyooyo.',
    '.rooyyyyyyoor',
    'roooyywyyyor.',
    'rooyywwwwyoor',
    'royywwwwwyyor',
    'royywwwwwwyor',
    '.oyywwwwwwyo.',
  ],
]
const FLAME_COLORS: Readonly<Record<string, string>> = { R: '#a8231a', r: '#e0401c', o: '#ff8a1c', y: '#ffd23f', w: '#fff4c4' }

// The logs under the flames, and the stones around them: back row, then front.
const LOGS = [
  '..eLl.....lLe..',
  'eeLLLLLLLLLLLee',
  'EElllllllllllEE',
]
const STONES_BACK = [
  '..aab.aab.aab..',
  '.ccd..ccd..ccd.',
]
const STONES_FRONT = [
  'aab..aaab..aaab..aab',
  'cccd.ccccd.ccccd.ccd',
]
const HEARTH_COLORS: Readonly<Record<string, string>> = {
  e: '#d39a62', E: '#9a6a42', L: '#5e3820', l: '#3a2012',
  a: '#c48c6c', b: '#8f6a66', c: '#4a4b60', d: '#34354a',
}

/** A mountain range: each column up from the foot to the highest peak's slope, snow near the top. */
function range(f: Frame, peaks: readonly Peak[], c: Range, jag: number): void {
  for (let x = 0; x < W; x++) {
    let top = Infinity
    let peak = peaks[0]
    for (const p of peaks) {
      const y = p.top + Math.abs(x - p.x) * p.slope
      if (y < top) {
        top = y
        peak = p
      }
    }
    if (!peak) return
    const ridge = Math.round(top + Math.sin(x * 1.3 + jag) * 0.7)
    const snowLine = peak.top + c.depth + Math.round(Math.sin(x * 0.9 + jag) * 1.5 + Math.sin(x * 2.3 + jag))
    const isLit = x > peak.x
    for (let y = ridge; y < HZ; y++)
      put(f, x, y, y <= snowLine ? (isLit ? c.snow : c.snowShade) : isLit ? c.lit : c.shade)
  }
}

/** A pine in tiers, each tier's top a shelf of snow. */
function pine(f: Frame, cx: number, base: number, height: number, c: Pine): void {
  const top = base - height
  for (let r = 0; r < height - 1; r++) {
    const hw = Math.floor(r / 3) + (r % 3)
    for (let x = cx - hw; x <= cx + hw; x++) {
      const isLit = x > cx
      const isEdge = x === cx - hw || x === cx + hw
      let color = isLit ? c.lit : c.dark
      if (r % 3 === 0 || (r % 3 === 1 && isEdge)) color = isLit || x === cx ? c.snow : c.snowShade
      put(f, x, top + r, color)
    }
  }
  put(f, cx, base - 1, c.trunk)
}

/** The gable roof: snow on both slopes, the board under it, planks in the gable; icicles at the eaves. */
function roof(f: Frame): void {
  const { cx, top, rows } = ROOF
  const c = ROOF_COLORS
  for (let r = 0; r < rows; r++) {
    const left = cx - 2 * r
    const right = cx + 1 + 2 * r
    for (let x = left; x <= right; x++) {
      const fromEdge = Math.min(x - left, right - x)
      const isRight = x > cx
      const color =
        r < 2 || fromEdge < 5
          ? isRight ? c.snow : c.snowShade
          : fromEdge < 7
            ? c.board
            : x % 2 === 0 ? c.gable : c.gableDark
      put(f, x, top + r, color)
    }
  }
  const eave = top + rows
  for (const x of [cx - 2 * rows + 2, cx - 2 * rows + 4, cx + 2 * rows - 3, cx + 2 * rows - 1]) put(f, x, eave, c.icicle)
  for (const x of [cx - 2 * rows + 2, cx + 2 * rows - 1]) put(f, x, eave + 1, c.icicle)
}

/** Campfire's layers, back to front. */
export function campfire(isPlaying: boolean): string[] {
  const rnd = rng(11)

  // The sky in dithered bands, the stars, the moon.
  const back = frame(SKY[0])
  for (let i = 0; i < 7; i++)
    for (let y = BANDS[i] ?? 0; y < (BANDS[i + 1] ?? HZ); y++)
      for (let x = 0; x < W; x++) put(back, x, y, (i > 0 && y === BANDS[i] && (x + y) % 2 === 0 ? SKY[i - 1] : SKY[i]) ?? '#03071a')
  const stars = Array.from({ length: 42 }, (_, i) => ({
    x: Math.floor(rnd() * W),
    y: Math.floor(rnd() * 24),
    color: STARS[i % 3] ?? '#ffffff',
    twinkles: rnd() < 0.4,
  }))
  for (const s of stars) if (!s.twinkles) put(back, s.x, s.y, s.color)
  const twinkle = [frame(), frame()] as const
  stars.filter(s => s.twinkles).forEach((s, i) => put(twinkle[i % 2 === 0 ? 0 : 1], s.x, s.y, s.color))
  for (let y = 2; y <= 16; y++)
    for (let x = 89; x <= 103; x++) {
      const lit = (x - 96) ** 2 + (y - 9) ** 2
      const shade = (x - 93.8) ** 2 + (y - 7.8) ** 2
      if (lit <= 27 && shade > 22) put(back, x, y, shade <= 30 ? '#d8d2ae' : '#fbf6dc')
    }

  // Mountains, the pines, the snowfield with its drifts.
  range(back, FAR_PEAKS, FAR, 1.7)
  range(back, NEAR_PEAKS, NEAR, 0.4)
  for (let x = 1; x < W; x += 3 + Math.floor(rnd() * 3)) pine(back, x, HZ, 6 + Math.floor(rnd() * 5), FAR_PINE)
  for (let x = 2; x < W; x += 5 + Math.floor(rnd() * 5)) pine(back, x, HZ + 2, 10 + Math.floor(rnd() * 7), NEAR_PINE)
  for (let i = 0; i < SNOW.length; i++)
    for (let y = SNOW_ROWS[i] ?? HZ; y < (SNOW_ROWS[i + 1] ?? H); y++)
      for (let x = 0; x < W; x++)
        put(back, x, y, (i > 0 && y === SNOW_ROWS[i] && (x + y) % 2 === 0 ? SNOW[i - 1] : SNOW[i]) ?? '#7d8dbf')
  for (const [cx, cy, rx] of [[52, 47, 8], [106, 51, 11], [20, 59, 13], [62, 62, 9]] as const)
    for (let x = cx - rx; x <= cx + rx; x++) {
      const k = (x - cx) / rx
      const rise = Math.round(3 * Math.sqrt(1 - k * k))
      for (let y = cy - rise; y < cy; y++) put(back, x, y, SNOW_DRIFT.body)
      put(back, x, cy - rise, k > -0.3 ? SNOW_DRIFT.lit : SNOW_DRIFT.body)
      if (k < 0.2) put(back, x, cy, SNOW_DRIFT.shade)
    }
  for (let i = 0; i < 26; i++) put(back, Math.floor(rnd() * W), HZ + 3 + Math.floor(rnd() * (H - HZ - 3)), SNOW_DRIFT.glint)
  // Footprints from the door to the fire.
  for (let k = 0; k < 12; k++) {
    const t = k / 11
    put(back, Math.round(29 + t * 40), Math.round(47 + t * 7 + Math.sin(t * 3) * 2) + (k % 2), SNOW_DRIFT.shade)
  }

  // The cabin: chimney, roof, wall, and the wood stacked by it.
  for (let y = 18; y < 27; y++) for (let x = 25; x < 28; x++) put(back, x, y, (x + y) % 2 === 0 ? '#5c5f73' : '#45475a')
  for (let x = 24; x < 29; x++) put(back, x, 17, '#e9f0fb')
  roof(back)
  sprite(back, WALL, CABIN_COLORS, WALL_AT.x, WALL_AT.y)
  sprite(back, WOODPILE, WOODPILE_COLORS, 33, 39)
  // The window's light, which flickers softly.
  const window = frame()
  sprite(window, WALL.slice(2, 9).map(row => row.replace(/[^fwho]/g, '.')), CABIN_COLORS, WALL_AT.x, WALL_AT.y + 2)

  // The glow on the snow around the fire, warm near it, fading out.
  const glow = frame()
  for (let y = HZ + 4; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = Math.sqrt(((x - FIRE.x) / 20) ** 2 + ((y - FIRE.y - 1) / 6) ** 2) * GLOW.length
      let ring = Math.floor(k)
      if (k - ring > 0.5 && (x + y) % 2 === 0) ring++
      const color = GLOW[ring]
      if (color !== undefined && !(ring === GLOW.length - 1 && (x + y) % 2 === 1)) put(glow, x, y, color)
    }

  // The hearth: stones behind, then flames and logs, then stones in front.
  const hearth = frame()
  sprite(hearth, STONES_BACK, HEARTH_COLORS, FIRE.x - 7, FIRE.y - 2)
  const front = frame()
  sprite(front, STONES_FRONT, HEARTH_COLORS, FIRE.x - 10, FIRE.y + 2)
  const flames = FLAMES.map(rows => {
    const f = frame()
    sprite(f, rows, FLAME_COLORS, FIRE.x - 6, FIRE.y - rows.length + 1)
    sprite(f, LOGS, HEARTH_COLORS, FIRE.x - 7, FIRE.y)
    return drawn(f)
  })
  // Sparks rise and drift, yellow to red, then go out.
  const sparks = Array.from({ length: 8 }, (_, k) => {
    const f = frame()
    for (let i = 0; i < 4; i++) {
      const t = (k + i * 2) % 8
      if (t > 5) continue
      const x = FIRE.x - 4 + i * 3 + Math.round(Math.sin(t * 0.9 + i * 2) * 1.5) + (i % 2 === 0 ? -t : t) / 2
      put(f, x, FIRE.y - 13 - t * 2, t < 2 ? '#ffe28a' : t < 4 ? '#ff8a1c' : '#c3361c')
    }
    return drawn(f)
  })
  const smoke = Array.from({ length: 6 }, (_, k) => {
    const f = frame()
    for (let j = 0; j < 4; j++) {
      const t = (k + j * 1.5) % 6
      const x = Math.round(26 + t * 1.3)
      const y = Math.round(15 - t * 2.2)
      const color = t < 2 ? '#8a90ab' : t < 4 ? '#646b8c' : '#3f4769'
      put(f, x, y, color)
      if (t >= 1.5) put(f, x + 1, y, color)
      if (t >= 3) put(f, x, y - 1, color)
    }
    return drawn(f)
  })

  // Snow falling, far flakes slow and dim, near flakes bright.
  const far = Array.from({ length: 34 }, (): [number, number] => [Math.floor(rnd() * (W + 12)), Math.floor(rnd() * H)])
  const near = Array.from({ length: 16 }, (): [number, number] => [Math.floor(rnd() * (W + 18)), Math.floor(rnd() * H)])

  const softly = isPlaying ? `<animate attributeName="opacity" values="1;0.8;0.95;0.75;1" dur="3.7s" ${LOOP}/>` : ''
  const pulse = isPlaying ? `<animate attributeName="opacity" values="0.8;1;0.85;0.95;0.75;0.8" dur="1.9s" ${LOOP}/>` : ''
  return [
    drawn(back),
    `<g>${blink(3.3, 0, 0.2)}${drawn(twinkle[0])}</g>`,
    `<g>${blink(4.7, -1.9, 0.2)}${drawn(twinkle[1])}</g>`,
    `<g>${softly}${drawn(window)}</g>`,
    `<g opacity="0.85">${pulse}${drawn(glow)}</g>`,
    isPlaying ? cycle(smoke, 2.4) : (smoke[0] ?? ''),
    // The snow falls behind the fire: a flake in the flames looks like a hole.
    fall(far, [[0, 0]], '#8c9ac6', { period: 16, dx: -12, steps: 64, isPlaying }),
    fall(near, [[0, 0]], '#eef3fc', { period: 9, dx: -18, steps: 64, isPlaying }),
    drawn(hearth),
    isPlaying ? cycle(flames, 0.6) : (flames[0] ?? ''),
    drawn(front),
    isPlaying ? cycle(sparks, 1.6) : '',
  ]
}
