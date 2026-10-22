import { BG, CYAN, H, LOOP, PINK, W, blink, cycle, drawn, frame, put, rng, runs } from '../pixel'

// Night Drive: a striped sun setting behind the city, a neon
// grid rolling towards you and a sports car. Synthwave, and the default.

const HZ = 40 // the horizon's row
const CX = W / 2

const SKY = ['#0b0221', '#13042b', '#1d0638', '#2a0a4a', '#3d0e5c', '#57136b', '#761a76']
const BANDS = [0, 7, 13, 19, 25, 30, 35, HZ]
const SUN = ['#ffe66d', '#ffd05a', '#ffb347', '#ff8c42', '#ff5e5b', '#ff3f81', '#e42a8f']
const STARS = ['#ffffff', '#ffc6f5', '#8be9fd']
const WINDOWS = ['#ffd166', '#ff5fd2', '#48e5ff']
const GRID = ['#4a1258', '#8a1a6c', '#c21d6e'] // far to near
const ROAD = ['#0a6f86', '#0ab3d1', CYAN]

// A wide 80s sports car from behind; the right half mirrors the left.
const CAR_LEFT = [
  '........oooooo',
  '.......okggggg',
  '......okghhggg',
  '....oooookkkkk',
  '..ookkkkkkkkkk',
  '.okRrrrrrrrrrr',
  '.okLLLLLLLLLLL',
  '.okrrrrrrrrrrr',
  '.okkkkkkkkkkpp',
  '.okkkkkkkkkkpp',
  '..tttt.......e',
  '..tttt........',
]
const CAR = CAR_LEFT.map(row => row + [...row].reverse().join(''))
const CAR_COLORS: Readonly<Record<string, string>> = {
  o: PINK, k: '#1a0b2e', g: '#3d2a6e', h: '#9f7be0', R: '#ffd0da',
  r: '#ff1f4b', L: '#5a0a22', p: '#d9d4ff', t: '#050208', e: '#8a8aa0',
}

/** The night drive's layers, back to front: the sun sets and the road rolls while music plays. */
export function nightdrive(isPlaying: boolean): string[] {
  const rnd = rng(7)
  const stars = Array.from({ length: 44 }, (_, i) => ({
    x: Math.floor(rnd() * W),
    y: Math.floor(rnd() * 28),
    color: STARS[i % 3] ?? '#ffffff',
    twinkles: rnd() < 0.35,
  }))
  const buildings: { x: number; w: number; h: number }[] = []
  for (let x = 0; x < W; ) {
    const w = 3 + Math.floor(rnd() * 5)
    const fromMiddle = Math.abs(x + w / 2 - CX)
    const h = fromMiddle < 16 ? 2 + Math.floor(rnd() * 3) : 5 + Math.floor(rnd() * (fromMiddle > 38 ? 11 : 7))
    buildings.push({ x, w, h })
    x += w + (rnd() < 0.25 ? 1 : 0)
  }
  const windows: { x: number; y: number; color: string; flickers: boolean }[] = []
  for (const b of buildings)
    for (let y = HZ - b.h + 2; y < HZ - 1; y += 2)
      for (let x = b.x + 1; x < b.x + b.w - 1; x += 2)
        if (rnd() < 0.35) windows.push({ x, y, color: WINDOWS[Math.floor(rnd() * 3)] ?? '#ffd166', flickers: rnd() < 0.15 })

  // Sky in dithered bands, over the dark ground.
  const back = frame(SKY[0])
  for (let i = 0; i < 7; i++)
    for (let y = BANDS[i] ?? 0; y < (BANDS[i + 1] ?? HZ); y++)
      for (let x = 0; x < W; x++)
        put(back, x, y, (i > 0 && y === BANDS[i] && (x + y) % 2 === 0 ? SKY[i - 1] : SKY[i]) ?? BG)
  for (const s of stars) if (!s.twinkles) put(back, s.x, s.y, s.color)
  const twinkle = [frame(), frame()] as const
  stars.filter(s => s.twinkles).forEach((s, i) => put(twinkle[i % 2 === 0 ? 0 : 1], s.x, s.y, s.color))

  // The sun, its stripes sliding down: four frames, one row apart.
  const sun = [0, 1, 2, 3].map(shift => {
    const f = frame()
    const r = 20
    for (let y = HZ - r; y < HZ; y++) {
      const k = y - (HZ - r)
      const half = Math.floor(Math.sqrt(r * r - (y - HZ + 0.5) ** 2))
      if (k >= 9) {
        const q = (((k - 9 - shift) % 4) + 4) % 4
        if (k >= 15 ? q < 2 : q === 0) continue
      }
      for (let x = CX - half; x < CX + half; x++) put(f, x, y, SUN[Math.min(6, Math.floor(k / 3))] ?? PINK)
    }
    return drawn(f)
  })

  // Mountains, the city, the horizon and the grid's lines to the vanishing point.
  const front = frame()
  for (let x = 0; x < W; x++) {
    const d = Math.abs(x - (CX - 0.5)) / CX
    const top = Math.round(d * d * (15 + 3 * Math.sin(x * 0.37) + 2 * Math.sin(x * 0.91 + 2)))
    for (let y = HZ - top; y < HZ; y++) put(front, x, y, y === HZ - top ? '#b0186f' : '#22073a')
  }
  for (const b of buildings)
    for (let y = HZ - b.h; y < HZ; y++)
      for (let x = b.x; x < b.x + b.w; x++) put(front, x, y, y === HZ - b.h ? '#2b0d4d' : '#150427')
  for (const w of windows) if (!w.flickers) put(front, w.x, w.y, w.color)
  const flicker = [frame(), frame()] as const
  windows.filter(w => w.flickers).forEach((w, i) => put(flicker[i % 2 === 0 ? 0 : 1], w.x, w.y, w.color))
  for (let x = 0; x < W; x++) put(front, x, HZ, PINK)
  for (let y = HZ + 1; y < H; y++) {
    const spread = (y - HZ) * 0.55
    const depth = y < HZ + 4 ? 0 : y < HZ + 9 ? 1 : 2
    for (let k = -12; k <= 12; k++)
      put(front, CX - 0.5 + k * spread, y, (Math.abs(k) === 1 ? ROAD[depth] : GRID[depth]) ?? PINK)
  }

  // The grid's cross lines rolling towards you: ten frames of one second.
  const grid = Array.from({ length: 10 }, (_, i) => {
    const f = frame()
    for (let line = 0; line < 8; line++) {
      const z = line + 1 - i / 10
      if (z < 0.3) continue
      const y = Math.round(HZ + 22 / z)
      if (y > HZ + 1 && y < H)
        for (let x = 0; x < W; x++) put(f, x, y, z > 4 ? '#4a1258' : z > 2.5 ? '#a01d6e' : PINK)
    }
    return drawn(f)
  })

  // The car, bobbing a pixel, its tail lights flaring now and then.
  const car = [0, 1].map(lift => {
    const body = frame()
    const lights = frame()
    CAR.forEach((row, yy) =>
      [...row].forEach((ch, xx) => {
        const color = CAR_COLORS[ch]
        if (color !== undefined) put(ch === 'r' ? lights : body, CX - 14 + xx, H - 12 - lift + yy, color)
      }),
    )
    const flare = isPlaying
      ? `<animate attributeName="fill" values="#ff1f4b;#ff6b86;#ff1f4b" keyTimes="0;0.86;0.93" calcMode="discrete" dur="1.4s" ${LOOP}/>`
      : ''
    return `${drawn(body)}<path fill="#ff1f4b" d="${runs(lights).get('#ff1f4b') ?? ''}">${flare}</path>`
  })

  return [
    drawn(back),
    `<g>${blink(3.1, 0, 0.2)}${drawn(twinkle[0])}</g>`,
    `<g>${blink(4.3, -1.7, 0.2)}${drawn(twinkle[1])}</g>`,
    isPlaying ? cycle(sun, 0.8) : (sun[0] ?? ''),
    drawn(front),
    `<g>${blink(5.3, -0.6, 0)}${drawn(flicker[0])}</g>`,
    `<g>${blink(7.1, -3.2, 0)}${drawn(flicker[1])}</g>`,
    isPlaying ? cycle(grid, 1) : (grid[0] ?? ''),
    isPlaying ? cycle(car, 0.8) : (car[0] ?? ''),
  ]
}
