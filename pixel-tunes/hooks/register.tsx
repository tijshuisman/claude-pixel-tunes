import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, UiOpenResult } from 'claude-code'

import type { Browse, Item, Playback, RepeatMode, ThemeChoice, ThemeId, Track, View } from '../types'
import { DEMO_QUEUE } from './demo'
import { artistsOf, lookUpGenre, nameKey, remember, themeFor } from './genre'
import type { Lookup } from './genre'
import { BG, CYAN, LILAC, PINK } from './pixel'
import { SIZE, bar, coverArt, fmt, pixelLabel, progress, scene, strip } from './render'
import {
  SpotifyError,
  artworkDataUri,
  beginLogin,
  cancelLogin,
  configure,
  control,
  devices,
  enqueue,
  finishLogin,
  forget,
  hasClientId,
  isSaved,
  listen,
  logout,
  myPlaylists,
  openOnMac,
  originOf,
  playbackState,
  playlistName,
  profile,
  recentlyPlayed,
  resume,
  search,
  setSaved,
  toPlayback,
  transfer,
  upcoming,
} from './spotify'
import { THEMES, THEME_IDS } from './themes'

const PANE = 'pixel-tunes'
const SETUP_URL = 'https://github.com/tijshuisman/claude-pixel-tunes#spotify-setup'

const IDLE: Playback = {
  track: null,
  isPlaying: false,
  positionMs: 0,
  at: 0,
  shuffle: false,
  repeat: 'off',
  volume: 60,
  device: 'MacBook Pro',
}

const playback = atom({ plugin: 'pixel-tunes', key: 'playback' } as const, IDLE)
const queue = atom({ plugin: 'pixel-tunes', key: 'queue' } as const, [])
const liked = atom({ plugin: 'pixel-tunes', key: 'liked' } as const, [])
const account = atom({ plugin: 'pixel-tunes', key: 'account' } as const, { status: 'demo' })
const artwork = atom({ plugin: 'pixel-tunes', key: 'artwork' } as const, null)
const picker = atom({ plugin: 'pixel-tunes', key: 'devices' } as const, null)
const notice = atom({ plugin: 'pixel-tunes', key: 'notice' } as const, null)

const NO_THEME: ThemeChoice = { auto: 'nightdrive', reason: 'default', basis: '', manual: null, isPicking: false }
const theme = atom({ plugin: 'pixel-tunes', key: 'theme' } as const, NO_THEME)

const NO_BROWSING: Browse = { view: 'queue', query: '', search: [], playlists: [], hasMorePlaylists: false, recent: [], loading: null, message: null }
const browse = atom({ plugin: 'pixel-tunes', key: 'browse' } as const, NO_BROWSING)

/** The pixel heading over each view. */
const HEADINGS: Readonly<Record<View, string>> = { queue: 'UP NEXT', search: 'SEARCH', playlists: 'PLAYLISTS', recent: 'RECENT' }

const VIEWS: readonly [View, string][] = [
  ['queue', 'Queue'],
  ['search', 'Search'],
  ['playlists', 'Playlists'],
  ['recent', 'Recent'],
]

const GROUPS: readonly [Item['kind'], string][] = [
  ['track', 'Tracks'],
  ['album', 'Albums'],
  ['playlist', 'Playlists'],
  ['artist', 'Artists'],
]

type Action = 'toggle' | 'next' | 'prev' | 'end' | 'shuffle' | 'repeat' | 'louder' | 'softer' | { play: string }

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: 'context', context: 'track', track: 'off' }

// Text glyphs, with U+FE0E so the desktop draws them as text, not emoji.
const ICON = {
  prev: '⏮︎',
  next: '⏭︎',
  play: '▶︎',
  pause: '⏸︎',
  shuffle: '⤮',
  repeat: '↻',
  heart: '♥︎',
  noHeart: '♡',
}

const clampVolume = (v: number) => Math.min(100, Math.max(0, v))

/** Where the track stands at `now`, from the playback's snapshot. */
function positionAt(p: Playback, now: number): number {
  const duration = p.track?.durationMs ?? 0
  const position = p.isPlaying ? p.positionMs + (now - p.at) : p.positionMs
  return Math.min(duration, Math.max(0, position))
}

/** Whether Spotify's answer differs from what the pane shows enough to redraw. */
function changed(a: Playback, b: Playback, now: number): boolean {
  if (
    a.track?.id !== b.track?.id ||
    a.track?.imageUrl !== b.track?.imageUrl ||
    a.isPlaying !== b.isPlaying ||
    a.shuffle !== b.shuffle ||
    a.repeat !== b.repeat ||
    a.volume !== b.volume ||
    a.device !== b.device ||
    a.context !== b.context
  )
    return true
  return Math.abs(positionAt(a, now) - b.positionMs) > 2_500
}

/** The page of a track on open.spotify.com, from its `spotify:<type>:<id>` URI. */
function webUrl(t: Track): string | undefined {
  const [, type, id] = (t.uri ?? '').split(':')
  return type && id && /^[A-Za-z0-9]+$/.test(id) ? `https://open.spotify.com/${type}/${id}` : undefined
}

/* ── the demo player (until Spotify is connected) ─────────────────────── */

/** What an action does to the demo playback. Pure, so `update` may retry it. */
function step(p: Playback, list: readonly Track[], action: Action, now: number, pick: number): Playback {
  const start = (track: Track | null, isPlaying = true): Playback => ({ ...p, track, positionMs: 0, at: now, isPlaying: isPlaying && track !== null })
  const index = list.findIndex(t => t.id === p.track?.id)
  const neighbour = (delta: number) => list[(index + delta + list.length) % list.length] ?? null
  const following = () => (p.shuffle ? (list[pick % Math.max(1, list.length)] ?? null) : neighbour(1))

  if (typeof action === 'object') return start(list.find(t => t.id === action.play) ?? p.track)
  switch (action) {
    case 'toggle':
      return { ...p, isPlaying: !p.isPlaying && p.track !== null, positionMs: positionAt(p, now), at: now }
    case 'next':
      return start(following())
    case 'prev':
      return positionAt(p, now) > 3000 ? start(p.track, p.isPlaying) : start(neighbour(-1))
    case 'end':
      return start(p.repeat === 'track' ? p.track : following())
    case 'shuffle':
      return { ...p, shuffle: !p.shuffle }
    case 'repeat':
      return { ...p, repeat: NEXT_REPEAT[p.repeat] }
    case 'louder':
      return { ...p, volume: clampVolume(p.volume + 10) }
    case 'softer':
      return { ...p, volume: clampVolume(p.volume - 10) }
  }
}

// Module timers: a reload drops them and session.start starts them again.
let demoTimer: Timer | undefined
let pollTimer: Timer | undefined
let pollFailed = false
// The last cover asked for, and what came of it (for `/tunes debug`).
let artworkTried = ''
let artworkNote = 'not tried yet'
// The pane's width in cells as last drawn (for `/tunes debug`).
let paneColumns = 0
// When the pane last drew the progress, which counts on by itself from there.
let progressDrawnAt = 0
// Whether the person opted in to MusicBrainz (the genre_lookup option).
let genreLookup = false
// Playlist names by URI, asked of Spotify once a session; null when it gives none.
const playlistNames = new Map<string, string | null>()
// The tracks whose artist MusicBrainz was asked about this session; one that failed is taken out, to be asked again.
const askedTracks = new Set<string>()
// What the last genre lookup came to (for `/tunes debug`), never naming the track or its artist.
let genreNote = 'nothing looked up yet this session'

/** Text cut to `max` characters, an ellipsis where it was cut. */
function fit(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 1)).join('').trimEnd()}…`
}

/** Work nobody awaits (a timer's, a press's) must not leave a rejection behind. */
function quietly(work: Promise<unknown>): void {
  work.catch(() => undefined)
}

async function isConnected($: EngineInterface): Promise<boolean> {
  return (await read($, account)).status === 'connected'
}

/** In the demo, fires `end` when the playing track runs out. */
async function arm($: EngineInterface): Promise<void> {
  demoTimer?.cancel()
  demoTimer = undefined
  if (await isConnected($)) return
  const p = await read($, playback)
  if (!p.isPlaying || p.track === null) return
  const left = p.track.durationMs - positionAt(p, await $.clock.now())
  demoTimer = $.clock.after(Math.max(250, left), () => quietly(act($, 'end')))
}

/** The demo queue, paused at 1:37 of the first track. */
async function seed($: EngineInterface): Promise<void> {
  if ((await read($, queue)).length > 0) return
  const now = await $.clock.now()
  await update($, queue, () => DEMO_QUEUE)
  await update($, liked, () => ['demo-1'])
  await update($, playback, p => (p.track ? p : { ...p, track: DEMO_QUEUE[0] ?? null, positionMs: 97_000, at: now }))
}

async function act($: EngineInterface, action: Action): Promise<void> {
  if (await isConnected($)) return remote($, action)
  const now = await $.clock.now()
  const list = await read($, queue)
  const pick = Math.floor(Math.random() * 1_000_000)
  await update($, playback, p => step(p, list, action, now, pick))
  await arm($)
  await pickTheme($)
}

/* ── Spotify ──────────────────────────────────────────────────────────── */

async function say($: EngineInterface, text: string | null): Promise<void> {
  if ((await read($, notice)) !== text) await update($, notice, () => text)
}

function schedulePoll($: EngineInterface, ms: number): void {
  pollTimer?.cancel()
  pollTimer = $.clock.after(Math.max(250, ms), () => quietly(poll($)))
}

/** Reads Spotify's playback, redraws only on a real change, and plans the next look. */
async function poll($: EngineInterface): Promise<void> {
  if (!(await isConnected($))) return
  let wait = 20_000
  try {
    const now = await $.clock.now()
    const before = await read($, playback)
    const next = toPlayback(await playbackState($), now, before)
    if (changed(before, next, now)) await update($, playback, () => next)
    if (next.track?.id !== before.track?.id || next.context !== before.context) quietly(pickTheme($))
    if (next.track?.id !== before.track?.id || (await read($, queue)).some(t => t.id.startsWith('demo-'))) quietly(details($, next))
    // Same track, but its cover never arrived (a reload, a failed download): try once more.
    else if (next.track?.imageUrl && next.track.imageUrl !== artworkTried && (await read($, artwork))?.url !== next.track.imageUrl)
      quietly(fetchArtwork($, next.track))
    if (pollFailed) {
      pollFailed = false
      await say($, null)
    }
    // Pixel Tunes runs in every session: with the pane closed, look once a minute
    // (and as the track ends, so the spinner names the next one).
    const pane = (await $.ui.panes()).find(x => x.id === PANE)
    const isOpen = pane !== undefined
    if (next.track && next.isPlaying) wait = Math.min(isOpen ? 5_000 : 60_000, next.track.durationMs - next.positionMs + 1_000)
    else wait = isOpen ? 10_000 : 60_000
    // The progress counts on from when its frame loads, and the desktop may load that
    // frame again from the last drawing (after another session was in view): while
    // music plays, each look draws it anew, unless something just did or the person
    // is typing in the pane.
    if (pane && !pane.isFocused && next.isPlaying && now - progressDrawnAt >= 4_000) $.ui.invalidate('ui.render')
  } catch (error) {
    if (error instanceof SpotifyError && error.reason === 'invalid_grant') return signedOut($, 'Your Spotify access was revoked. Connect again.')
    pollFailed = true
    wait = error instanceof SpotifyError && error.status === 429 ? 30_000 : 20_000
    await say($, `Spotify cannot be reached: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
  schedulePoll($, wait)
}

/** Fetches the track's cover into the pane, noting what came of it. */
async function fetchArtwork($: EngineInterface, t: Track): Promise<void> {
  const url = t.imageUrl
  if (!url) {
    artworkNote = 'Spotify gave no cover for this track.'
    return
  }
  artworkTried = url
  const { dataUri, note } = await artworkDataUri($, url)
  artworkNote = note
  if (dataUri) await update($, artwork, () => ({ url, dataUri }))
}

/** On a new track: its artwork, the queue and whether it is saved. */
async function details($: EngineInterface, p: Playback): Promise<void> {
  const t = p.track
  try {
    if (t?.imageUrl && (await read($, artwork))?.url !== t.imageUrl) await fetchArtwork($, t)
    const list = await upcoming($)
    await update($, queue, () => list)
    if (t?.uri) {
      const saved = await isSaved($, t.uri)
      await update($, liked, ids => (saved ? (ids.includes(t.id) ? ids : [...ids.slice(-199), t.id]) : ids.filter(id => id !== t.id)))
    }
  } catch {
    // The next track change tries again.
  }
}

/** Whether Spotify refused because no device is active. */
const isIdle = (error: unknown) => error instanceof SpotifyError && (error.status === 404 || error.reason === 'NO_ACTIVE_DEVICE')

/** Turns a Spotify refusal into a line, or a device picker when nothing plays. */
async function trouble($: EngineInterface, error: unknown): Promise<void> {
  if (!(error instanceof SpotifyError)) return say($, 'Something went wrong with Spotify.')
  if (isIdle(error)) return pickDevice($, true)
  if (error.reason === 'invalid_grant') return signedOut($, 'Your Spotify access was revoked. Connect again.')
  if (error.status === 403)
    return say($, error.reason === 'PREMIUM_REQUIRED' ? 'This needs Spotify Premium.' : `Spotify does not allow this: ${error.message}`)
  return say($, error.message)
}

async function remote($: EngineInterface, action: Action): Promise<void> {
  const now = await $.clock.now()
  const p = await read($, playback)
  try {
    if (typeof action === 'object') {
      const t = (await read($, queue)).find(x => x.id === action.play)
      if (!t?.uri) return
      try {
        await control($, p.context ? { kind: 'play', uri: t.uri, context: p.context } : { kind: 'play', uri: t.uri })
      } catch (error) {
        // A queued track need not be in the playlist: then play it on its own.
        if (!p.context || (error instanceof SpotifyError && error.status === 404)) throw error
        await control($, { kind: 'play', uri: t.uri })
      }
    } else {
      switch (action) {
        case 'toggle':
          await control($, { kind: p.isPlaying ? 'pause' : 'resume' })
          await update($, playback, q => ({ ...q, isPlaying: !q.isPlaying && q.track !== null, positionMs: positionAt(q, now), at: now }))
          break
        case 'next':
          await control($, { kind: 'next' })
          break
        case 'prev':
          await control($, { kind: 'prev' })
          break
        case 'end':
          break
        case 'shuffle':
          await control($, { kind: 'shuffle', on: !p.shuffle })
          await update($, playback, q => ({ ...q, shuffle: !p.shuffle }))
          break
        case 'repeat': {
          const mode = NEXT_REPEAT[p.repeat]
          await control($, { kind: 'repeat', mode })
          await update($, playback, q => ({ ...q, repeat: mode }))
          break
        }
        case 'louder':
        case 'softer': {
          const volume = clampVolume(p.volume + (action === 'louder' ? 10 : -10))
          await control($, { kind: 'volume', percent: volume })
          await update($, playback, q => ({ ...q, volume }))
          break
        }
      }
    }
    await say($, null)
  } catch (error) {
    await trouble($, error)
  }
  schedulePoll($, 700)
}

/* ── the scene's theme ────────────────────────────────────────────────── */

/** The name of the playlist that plays, asked of Spotify once; null for an album, an artist or a Spotify-made list. */
async function nameOfPlaylist($: EngineInterface, context: string | undefined): Promise<string | null> {
  if (!context?.startsWith('spotify:playlist:') || !(await isConnected($))) return null
  if (playlistNames.has(context)) return playlistNames.get(context) ?? null
  try {
    const name = await playlistName($, context)
    playlistNames.set(context, name)
    return name
  } catch (error) {
    // Spotify keeps its own playlists from apps (404): there is no name to ask again for.
    if (error instanceof SpotifyError && (error.status === 404 || error.status === 403)) playlistNames.set(context, null)
    return null
  }
}

/** Chooses the scene for what plays now. With the opt-in, an unknown artist is looked up, then chosen again. */
async function pickTheme($: EngineInterface): Promise<void> {
  try {
    const p = await read($, playback)
    const choice = await themeFor($, p.track, p.context, await nameOfPlaylist($, p.context), genreLookup)
    const now = await read($, playback)
    // Another track came meanwhile: its own pick follows.
    if (now.track?.id !== p.track?.id || now.context !== p.context) return
    const before = await read($, theme)
    if (before.auto !== choice.auto || before.reason !== choice.reason || before.basis !== choice.basis)
      await update($, theme, t => ({ ...t, ...choice }))
    if (genreLookup && choice.reason === 'default' && p.track) quietly(lookUpThenPick($, p.track))
  } catch {
    // The scene stays as it is; the next track chooses again.
  }
}

/** Asks MusicBrainz about the track's artist, once a track; when its genres fit a family, chooses again. */
async function lookUpThenPick($: EngineInterface, track: Track): Promise<void> {
  if (askedTracks.has(track.id)) return
  askedTracks.add(track.id)
  let found: Lookup
  try {
    found = await lookUpGenre($, track)
  } catch (error) {
    // Not given up on: the artist's next track asks again.
    askedTracks.delete(track.id)
    genreNote = `last lookup failed: ${error instanceof Error ? error.message : 'unknown error'}; the artist's next track asks again`
    return
  }
  genreNote = `last lookup: ${lookupNote(found)}`
  if (found.kind === 'found' && found.theme !== null && (await read($, playback)).track?.id === track.id) await pickTheme($)
}

/** What a lookup came to, in words for `/tunes debug`: never the track or its artist. */
function lookupNote(found: Lookup): string {
  switch (found.kind) {
    case 'found':
      return found.theme === null ? "the artist's genres on MusicBrainz fit no scene" : `${THEMES[found.theme].name}, by the artist's genres on MusicBrainz`
    case 'unknown':
      return "MusicBrainz knows neither the artist's Spotify page nor the recording"
    case 'no-id':
      return 'Spotify gave neither an artist ID nor an ISRC'
  }
}

async function toggleThemes($: EngineInterface): Promise<void> {
  await update($, theme, t => ({ ...t, isPicking: !t.isPicking }))
}

/** The person's own pick, over every rule; null is automatic again. */
async function pickManual($: EngineInterface, id: ThemeId | null): Promise<void> {
  await update($, theme, t => ({ ...t, manual: id }))
}

/**
 * Makes the person's pick the rule for this artist or playlist and goes back
 * to automatic, which now chooses it. With no pick, the artist or playlist
 * that chose the scene comes off its list.
 */
async function keep($: EngineInterface, list: 'artist' | 'playlist'): Promise<void> {
  const t = await read($, theme)
  const p = await read($, playback)
  const artist = t.manual === null ? t.basis : artistsOf(p.track)[0]
  const key = list === 'artist' ? nameKey(artist ?? '') : (p.context ?? '')
  if (!key) return
  await remember($, list, key, t.manual)
  await update($, theme, x => ({ ...x, manual: null, isPicking: false }))
  await pickTheme($)
}

/** Why the scene is what it is, in a line for the pane. */
function because(t: ThemeChoice): string {
  if (t.manual !== null) return 'Your pick stays until you choose Automatic.'
  switch (t.reason) {
    case 'playlist':
      return 'Automatic: remembered for this playlist.'
    case 'artist':
      return `Automatic: by artist (${t.basis}).`
    case 'playlistName':
      return `Automatic: by playlist name (${t.basis}).`
    case 'musicbrainz':
      return `Automatic: by the genre of ${t.basis} (MusicBrainz).`
    case 'default':
      return 'Automatic: no known artist or playlist.'
  }
}

/* ── choosing music: search, playlists, recent ────────────────────────── */

const failure = (error: unknown) => (error instanceof Error ? error.message : 'Spotify did not answer.')

async function openView($: EngineInterface, view: View): Promise<void> {
  const before = await read($, browse)
  await update($, browse, b => ({ ...b, view, message: null }))
  if (view === 'playlists' && before.playlists.length === 0) return loadPlaylists($, false)
  if (view === 'recent') return loadRecent($)
}

async function lookUp($: EngineInterface, text: string): Promise<void> {
  const query = text.trim()
  if (!query) {
    await update($, browse, b => ({ ...b, message: 'Type what you are looking for.' }))
    return
  }
  await update($, browse, b => ({ ...b, query, loading: 'search', message: null }))
  try {
    const found = await search($, query)
    await update($, browse, b => ({ ...b, search: found, loading: null, message: found.length ? null : `Nothing found for “${query}”.` }))
  } catch (error) {
    await update($, browse, b => ({ ...b, loading: null, message: `Search failed: ${failure(error)}` }))
  }
}

async function loadPlaylists($: EngineInterface, more: boolean): Promise<void> {
  const offset = more ? (await read($, browse)).playlists.length : 0
  await update($, browse, b => ({ ...b, loading: 'playlists', message: null }))
  try {
    const page = await myPlaylists($, offset)
    await update($, browse, b => ({
      ...b,
      playlists: more ? [...b.playlists, ...page.items] : page.items,
      hasMorePlaylists: page.hasMore,
      loading: null,
      message: !more && page.items.length === 0 ? 'You have no playlists yet.' : null,
    }))
  } catch (error) {
    await update($, browse, b => ({ ...b, loading: null, message: `Could not load your playlists: ${failure(error)}` }))
  }
}

async function loadRecent($: EngineInterface): Promise<void> {
  await update($, browse, b => ({ ...b, loading: 'recent', message: null }))
  try {
    const items = await recentlyPlayed($)
    await update($, browse, b => ({ ...b, recent: items, loading: null, message: items.length ? null : 'Nothing played yet.' }))
  } catch (error) {
    await update($, browse, b => ({ ...b, loading: null, message: `Could not load recently played: ${failure(error)}` }))
  }
}

/** Starts a result on `device`, else on the active one: a track within its album or playlist, anything else as a whole. */
async function start($: EngineInterface, item: Item, device?: string): Promise<void> {
  if (item.kind !== 'track') return control($, { kind: 'context', context: item.uri, device })
  try {
    await control($, item.context ? { kind: 'play', uri: item.uri, context: item.context, device } : { kind: 'play', uri: item.uri, device })
  } catch (error) {
    // Not every context takes an offset (an artist's does not): then the track alone.
    if (!item.context || (error instanceof SpotifyError && error.status === 404)) throw error
    await control($, { kind: 'play', uri: item.uri, device })
  }
}

/** The one Spotify Connect device there is; undefined when there are none or several. */
async function onlyDevice($: EngineInterface): Promise<string | undefined> {
  const list = await devices($).catch(() => [])
  return list.length === 1 ? list[0]?.id : undefined
}

/**
 * Plays a result. With no device active it plays on the only one there is
 * (waking it with this, not with what it played last); otherwise the pane
 * says what is wrong. Resolves to Spotify's refusal, or null when it plays.
 */
async function playItem($: EngineInterface, item: Item): Promise<unknown> {
  try {
    try {
      await start($, item)
    } catch (error) {
      const only = isIdle(error) ? await onlyDevice($) : undefined
      if (only === undefined) throw error
      await start($, item, only)
    }
    await say($, null)
    return null
  } catch (error) {
    await trouble($, error)
    return error
  } finally {
    schedulePoll($, 700)
  }
}

async function addToQueue($: EngineInterface, item: Item): Promise<void> {
  try {
    await enqueue($, item.uri)
    await say($, `Queued: ${item.title}`)
  } catch (error) {
    return trouble($, error)
  }
  try {
    const list = await upcoming($)
    await update($, queue, () => list)
  } catch {
    // The next track change fetches the queue again.
  }
}

async function like($: EngineInterface): Promise<void> {
  const { track } = await read($, playback)
  if (!track) return
  const isLiked = (await read($, liked)).includes(track.id)
  if ((await isConnected($)) && track.uri) {
    try {
      await setSaved($, track.uri, !isLiked)
    } catch (error) {
      return trouble($, error)
    }
  }
  await update($, liked, ids => (isLiked ? ids.filter(id => id !== track.id) : [...ids.slice(-199), track.id]))
}

/** Lists the Spotify Connect devices; with `auto`, one lone device is simply chosen. */
async function pickDevice($: EngineInterface, auto: boolean): Promise<void> {
  try {
    const list = await devices($)
    const only = list[0]
    if (auto && list.length === 1 && only) {
      await transfer($, only.id, true)
      await update($, picker, () => null)
      await say($, null)
      schedulePoll($, 1_000)
      return
    }
    await update($, picker, () => list)
    await say($, list.length === 0 ? 'No Spotify device found. Open Spotify and try again.' : 'Choose where Pixel Tunes plays:')
  } catch (error) {
    await say($, error instanceof Error ? error.message : 'Could not load your devices.')
  }
}

async function togglePicker($: EngineInterface): Promise<void> {
  if (!(await isConnected($))) return say($, 'Connect Spotify first to choose a device.')
  if ((await read($, picker)) !== null) {
    await update($, picker, () => null)
    return say($, null)
  }
  return pickDevice($, false)
}

async function choose($: EngineInterface, id: string): Promise<void> {
  try {
    await transfer($, id, true)
    await update($, picker, () => null)
    await say($, null)
  } catch (error) {
    await trouble($, error)
  }
  schedulePoll($, 1_000)
}

/** Starts the Spotify app on this Mac, then looks for it as a device. */
async function wakeSpotify($: EngineInterface): Promise<void> {
  await say($, 'Opening Spotify…')
  await openOnMac($, '-a', 'Spotify')
  await $.clock.sleep(4_000)
  await pickDevice($, true)
}

async function connected($: EngineInterface, name: string): Promise<void> {
  demoTimer?.cancel()
  await update($, account, () => ({ status: 'connected', name }))
  await update($, artwork, () => null)
  await update($, picker, () => null)
  await say($, null)
  schedulePoll($, 100)
}

async function complete($: EngineInterface, params: URLSearchParams): Promise<void> {
  try {
    await finishLogin($, params)
    await connected($, await profile($))
  } catch (error) {
    await update($, account, () => ({ status: 'error', message: error instanceof Error ? error.message : 'Could not connect.' }))
  }
}

/** The login: a one-shot local server for the redirect, then the browser. */
async function connect($: EngineInterface): Promise<void> {
  try {
    const { url, state } = await beginLogin()
    await update($, account, () => ({ status: 'connecting', url }))
    await say($, null)
    const waiting = listen($, state)
    await $.clock.sleep(400)
    await openOnMac($, url)
    const { params, failedFast } = await waiting
    if ((await read($, account)).status !== 'connecting') return
    if (params) return complete($, params)
    if (failedFast)
      await update($, account, a =>
        a.status === 'connecting'
          ? { ...a, hint: 'Pixel Tunes cannot catch the answer from Spotify by itself. After you log in, paste the address from your address bar below.' }
          : a,
      )
    else await update($, account, () => ({ status: 'error', message: 'No answer from Spotify within five minutes. Try again.' }))
  } catch (error) {
    await update($, account, () => ({ status: 'error', message: error instanceof Error ? error.message : 'Could not connect.' }))
  }
}

/** The fallback: the address the browser landed on, pasted into the pane. */
async function pasted($: EngineInterface, text: string): Promise<void> {
  let params: URLSearchParams
  try {
    params = new URL(text.trim()).searchParams
  } catch {
    await update($, account, a => (a.status === 'connecting' ? { ...a, hint: 'That is not an address. Paste the whole address from your address bar.' } : a))
    return
  }
  await complete($, params)
}

async function cancel($: EngineInterface): Promise<void> {
  cancelLogin()
  await update($, account, () => ({ status: 'demo' }))
}

async function signedOut($: EngineInterface, message: string): Promise<void> {
  pollTimer?.cancel()
  forget()
  await update($, account, () => ({ status: 'error', message }))
}

async function disconnect($: EngineInterface): Promise<void> {
  pollTimer?.cancel()
  await logout($)
  await update($, account, () => ({ status: 'demo' }))
  await update($, artwork, () => null)
  await update($, picker, () => null)
  await say($, null)
  await update($, browse, () => NO_BROWSING)
  await update($, queue, () => [])
  await update($, playback, () => IDLE)
  await seed($)
  await pickTheme($)
}

/** At the session's start: a login kept in the Keychain resumes by itself. */
async function boot($: EngineInterface): Promise<void> {
  try {
    if (await resume($)) return connected($, await profile($))
    if (await isConnected($)) await update($, account, () => ({ status: 'demo' }))
  } catch (error) {
    await update($, account, () => ({
      status: 'error',
      message: `Could not connect to Spotify again: ${error instanceof Error ? error.message : 'unknown error'}`,
    }))
  }
}

/** Long work (a login waits on the browser) runs on a timer, not in the hook. */
function soon($: EngineInterface, work: 'connect' | 'wake'): void {
  $.clock.after(0, () => quietly(work === 'connect' ? connect($) : wakeSpotify($)))
}

/* ── Claude as DJ: the play_music tool ────────────────────────────────── */

// Spotify's terms keep its content out of AI models: the model hears only how
// a play went, in these fixed lines, never a title, an artist or an address.
// What plays, the person sees in the pane and in the spinner.
const ANSWER = {
  playing: 'Playback started.',
  noQuery: 'Give a search term.',
  notFound: 'Nothing found on Spotify.',
  signedOut: 'Not connected to Spotify: the user connects in the Pixel Tunes pane.',
  noDevice: 'No Spotify device active: the user picks or opens one in the Pixel Tunes pane.',
  premium: 'Playback needs Spotify Premium.',
  busy: 'Spotify asks for a break: try again in a minute.',
  failed: 'Playback failed.',
} as const

const KINDS: readonly Item['kind'][] = ['track', 'album', 'playlist', 'artist']

/** What the model reads about play_music. */
const PLAY_MUSIC = [
  'Puts music on in Spotify with Pixel Tunes, the player next to the chat. Use this when the user asks you to put music on.',
  'Pixel Tunes searches by itself and plays the best match on the Spotify device of the user; a track plays within its album.',
  'For a mood or an activity ("something calm for debugging"), think of a short search term and choose kind "playlist".',
  'The result only says whether playback worked, not what plays: Spotify does not allow its content to go to an AI model.',
  'The user sees what plays in the pane and the spinner.',
].join(' ')

const PLAY_MUSIC_INPUT = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'What to search Spotify for: title and artist ("Nightcall Kavinsky"), an album, artist or playlist, or a mood ("lofi focus").',
    },
    kind: {
      type: 'string',
      enum: KINDS,
      description: 'What to play: a track (also without kind), an album, a playlist or an artist.',
    },
  },
  required: ['query'],
  additionalProperties: false,
}

/** The line for the model when Spotify refused: how it went, never Spotify's own words. */
function refusal(error: unknown): string {
  if (isIdle(error)) return ANSWER.noDevice
  if (!(error instanceof SpotifyError)) return ANSWER.failed
  if (error.status === 401 || error.reason === 'invalid_grant') return ANSWER.signedOut
  if (error.reason === 'PREMIUM_REQUIRED') return ANSWER.premium
  return error.status === 429 ? ANSWER.busy : ANSWER.failed
}

/** Opens the pane: from /tunes, from the band's button, or for play_music. */
async function openPane($: EngineInterface): Promise<UiOpenResult> {
  const opened = await $.ui.open({ id: PANE, title: 'Pixel Tunes' })
  // The band's button is there only while the pane is closed.
  $.ui.invalidate('ui.render')
  // Closed, the pane looked once a minute: look now, and every few seconds from here.
  if (await isConnected($)) schedulePoll($, 0)
  return opened
}

/** Opens the pane, where the person connects or picks a device; resolves to `line`. */
async function toPane($: EngineInterface, line: string): Promise<string> {
  await openPane($).catch(() => undefined)
  return line
}

/**
 * play_music: Pixel Tunes searches Spotify itself and plays the best match of
 * the kind asked for (a track, within its album, when none is). When Spotify
 * is not connected or refuses, the pane opens to set it right.
 */
async function playMusic($: EngineInterface, query: unknown, kind: unknown): Promise<string> {
  const text = typeof query === 'string' ? query.trim() : ''
  if (!text) return ANSWER.noQuery
  if (!(await isConnected($))) return toPane($, ANSWER.signedOut)
  let found: Item[]
  try {
    found = await search($, text)
  } catch (error) {
    await trouble($, error)
    return toPane($, refusal(error))
  }
  const wanted = KINDS.find(k => k === kind)
  const item = found.find(i => wanted === undefined || i.kind === wanted)
  if (!item) return ANSWER.notFound
  const refused = await playItem($, item)
  return refused === null ? ANSWER.playing : toPane($, refusal(refused))
}

const COMMAND_WORDS: Readonly<Record<string, Action>> = {
  next: 'next',
  prev: 'prev',
  shuffle: 'shuffle',
  repeat: 'repeat',
}

export const register: Register = (on, options) => {
  configure(String(options['spotify_client_id'] ?? ''), Number(options['callback_port'] ?? 8898))
  genreLookup = options['genre_lookup'] === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tunes',
      description: 'Open the Pixel Tunes player (pixel art + Spotify)',
      argumentHint: '[play | pause | next | prev | login | logout | debug]',
      immediate: true,
    })
    // Claude as DJ: the schema is in the prompt from the first turn, so the model reaches for it.
    // A session that takes no tools from plugins (--bare, --tools "") still gets the player.
    await $.tool.register({ name: 'play_music', description: PLAY_MUSIC, inputSchema: PLAY_MUSIC_INPUT, isDeferred: false }).catch(() => undefined)
    await seed($)
    await arm($)
    // Also after a reload, when what plays is still in the state: its scene now, not at the next track.
    await pickTheme($)
    $.clock.after(0, () => quietly(boot($)))
    return next(e)
  })

  on('command.run', { command: 'tunes' }, async ($, e) => {
    const word = (e.args ?? '').trim().toLowerCase()
    if (word === 'login' || word === 'connect') {
      if (!hasClientId()) return { text: `No Spotify Client ID is set yet. Here is how to make one: ${SETUP_URL}` }
      soon($, 'connect')
      return { text: 'Your browser opens the Spotify login.' }
    }
    if (word === 'debug') {
      const acct = await read($, account)
      const th = await read($, theme)
      const { track } = await read($, playback)
      if (track && acct.status === 'connected') await fetchArtwork($, track)
      const art = await read($, artwork)
      const shown = !art ? 'none' : art.url === track?.imageUrl ? `this cover (${Math.round(art.dataUri.length / 1024)} KB)` : 'a cover of an earlier track'
      // The model reads this too: no title, artist or image address, only which server.
      return {
        text: [
          `Spotify: ${acct.status}`,
          `Track: ${!track ? 'none' : track.uri ? 'from Spotify (title and artist are in the pane)' : 'demo'}`,
          `Cover server: ${originOf(track?.imageUrl)}`,
          `Fetching: ${artworkNote}`,
          `In the pane: ${shown}`,
          `Pane width: ${paneColumns || 'not drawn yet'} columns`,
          `Scene: ${THEMES[th.manual ?? th.auto].name}`,
          `Genre lookup: ${genreLookup ? `on · ${genreNote}` : 'off (the genre_lookup option)'}`,
        ].join('\n'),
      }
    }
    if (word === 'logout') {
      await disconnect($)
      return { text: 'Pixel Tunes is disconnected from Spotify; the token was removed from your Keychain.' }
    }
    if (word === 'play' || word === 'pause') {
      const { isPlaying } = await read($, playback)
      if (isPlaying !== (word === 'play')) await act($, 'toggle')
      return { text: word === 'play' ? '▶ Pixel Tunes is playing.' : '⏸ Pixel Tunes is paused.' }
    }
    const action = COMMAND_WORDS[word]
    if (action !== undefined) {
      await act($, action)
      const { track } = await read($, playback)
      // Only the demo's own tracks are named; a Spotify track (still shown after a lost login) never is.
      if ((await isConnected($)) || track?.uri) return { text: action === 'next' || action === 'prev' ? '♪ Track changed.' : '♪ Done.' }
      return { text: track ? `♪ ${track.title} – ${track.artist}` : 'Nothing is playing.' }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Pixel Tunes is open next to the chat.' : `Pixel Tunes is open, but waiting for room: ${opened.reason}` }
  })

  // play_music is answered here: the model hears how it went, never what plays.
  on('tool.call', { tool: 'mcp__pixel-tunes__play_music' }, async ($, e) => ({ result: await playMusic($, e.query, e.kind) })).catch(() => ({
    result: ANSWER.failed,
  }))

  // While Spotify plays, the spinner says what: "Thinking · ♪ Nightcall – Kavinsky…"
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const { isPlaying, track } = await read($, playback)
    if (!isPlaying || track === null || !(await isConnected($))) return next(e)
    return next({ ...e, props: { ...e.props, suffix: ` · ♪ ${track.title} – ${track.artist}…` } })
  })

  // While the pane is closed, the band above the prompt has a button that opens it: the
  // desktop app holds back a /tunes typed while Claude works, as it does any message.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)
    if ((await $.ui.panes()).some(x => x.id === PANE && x.isPlaced)) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" gap="xs">
        <Button key="open" label="♪ Pixel Tunes" onPress={() => quietly(openPane($))} />
        {await next(e)}
      </Box>
    )
  })

  // A pane the person closes brings the band's button back.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    $.ui.invalidate('ui.render')
    return closed
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const p = await read($, playback)
    const list = await read($, queue)
    const saved = await read($, liked)
    const acct = await read($, account)
    const art = await read($, artwork)
    const choices = await read($, picker)
    const line = await read($, notice)
    const b = await read($, browse)
    const th = await read($, theme)
    const shownTheme = th.manual ?? th.auto
    const t = p.track

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Text color={PINK} bold>
            PIXEL TUNES
          </Text>
          <Text>{t ? `${p.isPlaying ? ICON.play : ICON.pause} ${t.title} – ${t.artist}` : 'Nothing is playing.'}</Text>
          <Text dimColor>Scene: {THEMES[shownTheme].name}</Text>
          {line && <Text color="#ff7aa2">{line}</Text>}
          <Text dimColor>The pixel scene draws in the desktop app; a terminal version will follow.</Text>
        </Box>
      )
    }

    const elements = $.ui.resolve(e)
    const { Box, Button, Link, Svg, Text } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const isLiked = t !== null && saved.includes(t.id)
    const isLive = acct.status === 'connected'
    const index = Math.max(0, list.findIndex(x => x.id === t?.id))
    // What comes after the track shown above: the queue without what plays now.
    const upNext = isLive
      ? list.filter((x, k) => !(k === 0 && x.id === t?.id)).slice(0, 4)
      : list.length > 1
        ? [1, 2, 3, 4].map(k => list[(index + k) % list.length]).filter(x => x !== undefined && x.id !== t?.id)
        : []
    const bars = Math.round(p.volume / 10)
    const spotifyPage = t ? webUrl(t) : undefined
    const shown: View = isLive ? b.view : 'queue'
    const firstArtist = artistsOf(t)[0]
    const playlist = p.context?.startsWith('spotify:playlist:') ? p.context : undefined
    // The progress counts on by itself from the moment its frame loads, so it starts from
    // where the track is now, not from Spotify's last news, which may be minutes old.
    const now = await $.clock.now()
    const atNow: Playback = { ...p, positionMs: positionAt(p, now), at: now }
    progressDrawnAt = now
    // Rows are cut to fit: a cell of the pane holds about one character of its
    // proportional text, so the + beside a track stays in view.
    paneColumns = e.props.bodyColumns
    const room = Math.min(90, Math.max(20, Math.round(paneColumns * 1.1) - 4))

    // A heading in the pixel font of the title above, so the lower half speaks its style.
    const heading = (text: string, color: string, p = 1) => {
      const drawn = pixelLabel(text, color, p)
      return <Svg source={drawn.source} alt={text} width={drawn.width} height={drawn.height} />
    }

    // One result: press to play it; a track also has + for the queue. The title on
    // its own line, what it is from dimmed beneath.
    const row = (item: Item, id: string) => (
      <Box flexDirection="row" alignItems="center" gap="xs">
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Button key={`play-${id}`} plain onPress={() => quietly(playItem($, item))}>
            {fit(item.title, room)}
          </Button>
          {item.subtitle && (
            <Text color="#7d68a8" size="footnote">
              {fit(item.subtitle, room)}
            </Text>
          )}
        </Box>
        {item.kind === 'track' && <Button key={`queue-${id}`} plain dimColor label="+" onPress={() => quietly(addToQueue($, item))} />}
      </Box>
    )

    return (
      <Box flexDirection="column" backgroundColor={BG} paddingBottom="sm">
        <Box flexDirection="column" alignItems="center">
          <Svg
            source={scene(shownTheme, p.isPlaying)}
            alt={THEMES[shownTheme].alt}
            width={SIZE.scene.width}
            height={SIZE.scene.height}
            isInteractive
          />
          <Box flexDirection="row">
            <Svg
              source={coverArt(t, art)}
              alt={t ? `Cover of ${t.album || t.title}` : 'No cover'}
              width={SIZE.cover.width}
              height={SIZE.cover.height}
            />
            <Svg
              source={strip(p, isLiked)}
              alt={t ? `Now playing ${t.title} by ${t.artist}` : 'Nothing is playing'}
              width={SIZE.strip.width}
              height={SIZE.strip.height}
              isInteractive
            />
          </Box>
          <Svg source={progress(atNow)} alt="Track progress" width={SIZE.progress.width} height={SIZE.progress.height} isInteractive />
        </Box>

        <Box flexDirection="row" justifyContent="center" gap="xs" paddingY="sm">
          <Button key="shuffle" label={ICON.shuffle} dimColor={!p.shuffle} onPress={() => quietly(act($, 'shuffle'))} />
          <Button key="prev" label={ICON.prev} onPress={() => quietly(act($, 'prev'))} />
          <Button key="play" label={p.isPlaying ? ICON.pause : ICON.play} variant="primary" onPress={() => quietly(act($, 'toggle'))} />
          <Button key="next" label={ICON.next} onPress={() => quietly(act($, 'next'))} />
          <Button
            key="repeat"
            label={p.repeat === 'track' ? `${ICON.repeat}1` : ICON.repeat}
            dimColor={p.repeat === 'off'}
            onPress={() => quietly(act($, 'repeat'))}
          />
          <Button key="like" label={isLiked ? ICON.heart : ICON.noHeart} onPress={() => quietly(like($))} />
        </Box>

        <Box flexDirection="column" paddingX="sm" gap="sm">
          <Box flexDirection="column" gap="xs">
            <Box flexDirection="row" alignItems="center" gap="xs">
              {heading('ON', '#7d68a8', 2)}
              <Button key="device" plain label={`${p.device || 'Choose a device'} ▾`} onPress={() => quietly(togglePicker($))} />
              <Box flexGrow={1} />
              {heading('VOL', '#7d68a8', 2)}
              <Button key="softer" label="−" plain onPress={() => quietly(act($, 'softer'))} />
              <Text color={CYAN} mono>
                {'▮'.repeat(bars)}
                <Text color="#2a1452">{'▮'.repeat(10 - bars)}</Text>
              </Text>
              <Button key="louder" label="+" plain onPress={() => quietly(act($, 'louder'))} />
            </Box>

            <Box flexDirection="row" alignItems="center" gap="xs">
              {heading('SCENE', '#7d68a8', 2)}
              <Button key="theme" plain label={`${THEMES[shownTheme].name} ▾`} onPress={() => quietly(toggleThemes($))} />
            </Box>
          </Box>

          {th.isPicking && (
            <Box flexDirection="column">
              <Button
                key="theme-auto"
                plain
                label={`${th.manual === null ? '●' : '○'} Automatic (${THEMES[th.auto].name})`}
                onPress={() => quietly(pickManual($, null))}
              />
              {THEME_IDS.map(id => (
                <Button
                  key={`theme-${id}`}
                  plain
                  label={`${th.manual === id ? '●' : '○'} ${THEMES[id].name}`}
                  onPress={() => quietly(pickManual($, id))}
                />
              ))}
              <Text color={LILAC} size="footnote">
                {because(th)}
              </Text>
              {th.manual !== null && firstArtist && (
                <Button key="remember-artist" plain label="Remember for this artist" onPress={() => quietly(keep($, 'artist'))} />
              )}
              {th.manual !== null && playlist && (
                <Button key="remember-playlist" plain label="Remember for this playlist" onPress={() => quietly(keep($, 'playlist'))} />
              )}
              {th.manual === null && th.reason === 'artist' && (
                <Button key="forget-artist" plain dimColor label="Forget the pick for this artist" onPress={() => quietly(keep($, 'artist'))} />
              )}
              {th.manual === null && th.reason === 'playlist' && (
                <Button key="forget-playlist" plain dimColor label="Forget the pick for this playlist" onPress={() => quietly(keep($, 'playlist'))} />
              )}
            </Box>
          )}

          {choices !== null &&
            (choices.length > 0 ? (
              choices.map(d => (
                <Button key={`device-${d.id}`} plain onPress={() => quietly(choose($, d.id))}>
                  {d.isActive ? '● ' : '○ '}
                  {d.name}
                  <Text color={LILAC}> {d.type}</Text>
                </Button>
              ))
            ) : (
              <Button key="wake" label="Open Spotify on this Mac" onPress={() => soon($, 'wake')} />
            ))}

          {line && (
            <Text color="#ff7aa2" size="footnote">
              {line}
            </Text>
          )}

          {acct.status === 'demo' && (
            <Box flexDirection="column" gap="xs" paddingY="xs">
              <Text color={LILAC} size="footnote">
                {hasClientId()
                  ? 'This is demo data. Connect to control your own Spotify.'
                  : 'This is demo data. To control your own Spotify, you need the Client ID of a Spotify app of your own.'}
              </Text>
              {hasClientId() ? (
                <Button key="connect" label="Connect Spotify" onPress={() => soon($, 'connect')} />
              ) : (
                <Link href={SETUP_URL} label="How to make one" />
              )}
            </Box>
          )}

          {acct.status === 'connecting' && (
            <Box flexDirection="column" gap="xs" paddingY="xs">
              <Text color={LILAC} size="footnote">
                Log in to Spotify in your browser and give Pixel Tunes access.
              </Text>
              {acct.hint && (
                <Text color="#ffb347" size="footnote">
                  {acct.hint}
                </Text>
              )}
              <Link href={acct.url} label="Open the login page again" />
              {Input && (
                <Input key="paste" placeholder="Or paste the address here after logging in" submitLabel="connect" onSubmit={value => quietly(pasted($, value))} />
              )}
              <Button key="cancel" label="Cancel" plain dimColor onPress={() => quietly(cancel($))} />
            </Box>
          )}

          {acct.status === 'error' && (
            <Box flexDirection="column" gap="xs" paddingY="xs">
              <Text color="#ff7aa2" size="footnote">
                {acct.message}
              </Text>
              <Button key="connect" label="Connect again" onPress={() => soon($, 'connect')} />
            </Box>
          )}

          {isLive && (
            <Box flexDirection="row" flexWrap="wrap" gap="sm">
              {VIEWS.map(([view, name]) => (
                <Box flexDirection="column" gap="xs">
                  {view === shown ? (
                    <Button key={`tab-${view}`} plain onPress={() => quietly(openView($, view))}>
                      <Text color={PINK}>{name}</Text>
                    </Button>
                  ) : (
                    <Button key={`tab-${view}`} plain dimColor label={name} onPress={() => quietly(openView($, view))} />
                  )}
                  {view === shown && <Svg source={bar(name.length * 7)} alt="" width={name.length * 7} height={2} />}
                </Box>
              ))}
            </Box>
          )}

          {heading(HEADINGS[shown], CYAN, 2)}

          {shown === 'queue' && (
            <Box flexDirection="column" gap="sm">
              {upNext.length === 0 && (
                <Text color="#7d68a8" size="footnote">
                  {isLive ? 'Nothing in the queue yet.' : 'Empty.'}
                </Text>
              )}
              {upNext.map((track, k) => (
                <Box flexDirection="row" alignItems="center" gap="sm">
                  {heading(String(k + 1).padStart(2, '0'), PINK, 2)}
                  <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                    <Button key={`q-${k}-${track.id}`} plain onPress={() => quietly(act($, { play: track.id }))}>
                      {fit(track.title, room - 8)}
                    </Button>
                    <Text color="#7d68a8" size="footnote">
                      {fit(track.artist, room - 8)}
                    </Text>
                  </Box>
                  <Text color="#7d68a8" size="footnote" mono>
                    {fmt(track.durationMs)}
                  </Text>
                </Box>
              ))}
            </Box>
          )}

          {shown === 'search' && (
            <Box flexDirection="column" gap="xs">
              {Input ? (
                <Input
                  key="search"
                  placeholder="Track, album, artist or playlist"
                  value={b.query}
                  submitLabel="search"
                  onSubmit={value => quietly(lookUp($, value))}
                />
              ) : (
                <Text color="#7d68a8" size="footnote">
                  Search works in the desktop app.
                </Text>
              )}
              {GROUPS.map(([kind, title]) => {
                const items = b.search.filter(item => item.kind === kind)
                return items.length === 0 ? null : (
                  <Box flexDirection="column">
                    <Text color={LILAC} size="footnote">
                      {title}
                    </Text>
                    {items.map((item, i) => row(item, `s-${kind}-${i}`))}
                  </Box>
                )
              })}
            </Box>
          )}

          {shown === 'playlists' && (
            <Box flexDirection="column" gap="xs">
              {b.playlists.map((item, i) => row(item, `pl-${i}`))}
              {b.hasMorePlaylists && (
                <Button key="more-playlists" plain dimColor label="More playlists" onPress={() => quietly(loadPlaylists($, true))} />
              )}
            </Box>
          )}

          {shown === 'recent' && <Box flexDirection="column" gap="xs">{b.recent.map((item, i) => row(item, `r-${i}`))}</Box>}

          {isLive && b.loading === shown && (
            <Text color={LILAC} size="footnote">
              Loading…
            </Text>
          )}
          {isLive && shown !== 'queue' && b.message && (
            <Text color="#ffb347" size="footnote">
              {b.message}
            </Text>
          )}

          {isLive && (
            <Box flexDirection="row" alignItems="center" gap="xs">
              <Text color="#7d68a8" size="caption">
                Music via Spotify · {acct.name}
              </Text>
              <Box flexGrow={1} />
              {spotifyPage && <Link href={spotifyPage} label="Open in Spotify ↗" />}
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
