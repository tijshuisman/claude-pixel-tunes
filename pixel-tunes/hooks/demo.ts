import type { Track } from '../types'

/** Phase 1 stands in for Spotify with this queue; phase 2 replaces it. */
export const DEMO_QUEUE: Track[] = [
  { id: 'demo-1', title: 'Nightcall', artist: 'Kavinsky', album: 'OutRun', durationMs: 258_000, cover: { colors: ['#1a0433', '#7a1a7a', '#ff4fa3', '#00e5ff'], sun: [12, 12, 7] } },
  { id: 'demo-2', title: 'Odd Look', artist: 'Kavinsky', album: 'OutRun', durationMs: 252_000, cover: { colors: ['#120426', '#5b1270', '#ffd166', '#ff2a6d'], sun: [9, 11, 6] } },
  { id: 'demo-3', title: 'Tech Noir', artist: 'Gunship', album: 'Gunship', durationMs: 296_000, cover: { colors: ['#0b0a2e', '#2b3a8f', '#ff2a6d', '#00e5ff'], sun: [15, 13, 8] } },
  { id: 'demo-4', title: 'Resonance', artist: 'Home', album: 'Odyssey', durationMs: 212_000, cover: { colors: ['#06142e', '#0f5c6e', '#7ef0ff', '#ff9f43'], sun: [12, 14, 9] } },
  { id: 'demo-5', title: 'A Real Hero', artist: 'College & Electric Youth', album: 'Drive OST', durationMs: 268_000, cover: { colors: ['#0b1a3a', '#1f4f8f', '#ffd166', '#ff5fd2'], sun: [14, 10, 6] } },
  { id: 'demo-6', title: 'Turbo Killer', artist: 'Carpenter Brut', album: 'Trilogy', durationMs: 200_000, cover: { colors: ['#1f0208', '#7a0d2b', '#ff3b3b', '#ffe66d'], sun: [12, 12, 7] } },
  { id: 'demo-7', title: 'Sunset', artist: 'The Midnight', album: 'Endless Summer', durationMs: 311_000, cover: { colors: ['#2a0838', '#a3245e', '#ffb347', '#ffe66d'], sun: [12, 15, 10] } },
]
