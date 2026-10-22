import type { EngineInterface } from 'claude-code'

import type { ThemeId, ThemeReason, Track } from '../types'
import { THEME_IDS } from './themes'

// Which scene fits what plays. Spotify gives no genres any more, so the choice
// is made here, from lists kept on this Mac: the person's own picks per
// playlist and per artist, then words in the playlist's name. Only when the
// person opts in does a track's ISRC go to MusicBrainz, for its artist's genres.

/** A name as the lists keep it: without accents, lower case, one kind of apostrophe and of space. */
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase()
}

/** A track's artists, each on its own; a demo track knows only its one line. */
export function artistsOf(t: Track | null): string[] {
  if (!t) return []
  return t.artists?.length ? t.artists : t.artist ? [t.artist] : []
}

/* ── the lists, in $.store ────────────────────────────────────────────── */

const ARTISTS = 'theme-artists'
const PLAYLISTS = 'theme-playlists'
const GENRES = 'musicbrainz-genres'

const isTheme = (value: unknown): value is ThemeId => typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A stored list of names to themes; anything else in it is dropped. */
function themes(value: unknown): Record<string, ThemeId> {
  const out: Record<string, ThemeId> = {}
  if (isRecord(value)) for (const [key, theme] of Object.entries(value)) if (isTheme(theme)) out[key] = theme
  return out
}

/** The artists remembered, by name. */
export async function artistThemes($: EngineInterface): Promise<Record<string, ThemeId>> {
  return themes(await $.store.get(ARTISTS))
}

/** The playlists remembered, by their `spotify:playlist:…` URI. */
export async function playlistThemes($: EngineInterface): Promise<Record<string, ThemeId>> {
  return themes(await $.store.get(PLAYLISTS))
}

/** What MusicBrainz said per artist: a family, or null when none of its genres fits one. */
async function genreCache($: EngineInterface): Promise<Record<string, ThemeId | null>> {
  const stored = await $.store.get(GENRES)
  const out: Record<string, ThemeId | null> = {}
  if (isRecord(stored)) for (const [key, theme] of Object.entries(stored)) if (theme === null || isTheme(theme)) out[key] = theme
  return out
}

/** Keeps `theme` for an artist (by name) or a playlist (by URI); null takes it off the list. */
export async function remember($: EngineInterface, list: 'artist' | 'playlist', key: string, theme: ThemeId | null): Promise<void> {
  const entries = list === 'artist' ? await artistThemes($) : await playlistThemes($)
  if (theme === null) delete entries[key]
  else entries[key] = theme
  await $.store.set(list === 'artist' ? ARTISTS : PLAYLISTS, entries)
}

/* ── the rules ────────────────────────────────────────────────────────── */

// Words in a playlist's name, a rule per family, tried in this order.
const NAME_WORDS: readonly (readonly [ThemeId, RegExp])[] = [
  ['nightdrive', /\b(synth ?wave|retro ?wave|outrun|vapou?r ?wave|darksynth|dreamwave|night ?drive|nachtrit|cyberpunk|80s|eighties)\b/],
  ['dancefloor', /\b(house|disco|dance|dancing|dansen|dans|club|techno|edm|party|feest|funk)\b/],
  ['dreampop', /\b(dream ?pop|droom\w*|shoegaze|ambient|lo-?fi|chill\w*|sleep\w*|slaap\w*|downtempo|mellow)\b/],
  ['campfire', /\b(folk\w*|americana|acoustic|akoestisch\w*|singer-songwriter|country|bluegrass|campfire|kampvuur|cabin|cozy|fireside|winter)\b/],
  ['psychedelic', /\b(psych\w*|trippy|acid|surf|desert|woestijn|kraut\w*)\b/],
  ['citylights', /\b(indie|rock|garage|post-?punk|punk|new wave|alternative|britpop|grunge|city|stad|nyc|brooklyn|london|rain|regen)\b/],
]

/** The family a playlist's name points to, by its words; null when none does. */
export function themeOfName(name: string): ThemeId | null {
  const text = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  return NAME_WORDS.find(([, words]) => words.test(text))?.[0] ?? null
}

// Folk only by its exact names, so freak folk and psychedelic folk stay psychedelic.
const FOLK = new Set([
  'folk', 'indie folk', 'folk rock', 'alt-country', 'alternative country', 'americana', 'singer-songwriter', 'folktronica',
  'stomp and holler', 'contemporary folk', 'chamber folk', 'folk pop', 'country', 'bluegrass', 'acoustic',
])

// MusicBrainz genres, a rule per family, the first that fits wins: folk
// before psych, so a band tagged both folk and psychedelic lands at the campfire.
const GENRE_RULES: readonly (readonly [ThemeId, (genre: string) => boolean])[] = [
  ['nightdrive', g => /^(synthwave|retrowave|outrun|vaporwave|darksynth|dreamwave)$/.test(g)],
  ['dancefloor', g => /(^| )house$|disco|^dance-punk$|^big beat$|^uk garage$|^techno$|^dance$|^electroclash$/.test(g)],
  ['dreampop', g => /^(dream pop|shoegaze|slowcore|downtempo|ambient|ambient pop|chillwave|ethereal wave|trip hop)$/.test(g)],
  ['campfire', g => FOLK.has(g)],
  ['psychedelic', g => /psych|^freak folk$|^surf|^space rock$|^acid rock$|^krautrock$/.test(g)],
  ['citylights', g => /rock|punk|new wave|^indie|^alternative|britpop|grunge|^art pop$|^baroque pop$|^chamber pop$/.test(g)],
]

/** The family an artist's genres point to, by its four most voted; null when none fits. */
export function themeOfGenres(genres: readonly { name: string; count: number }[]): ThemeId | null {
  const top = [...genres].sort((a, b) => b.count - a.count).slice(0, 4).map(g => g.name.toLowerCase())
  return GENRE_RULES.find(([, fits]) => top.some(fits))?.[0] ?? null
}

export type Choice = { auto: ThemeId; reason: ThemeReason; basis: string }

/**
 * What the rules choose for a track, the first that answers: its playlist
 * remembered, one of its artists on the list, words in the playlist's name,
 * with `useGenres` what MusicBrainz said of an artist; else the night drive.
 * The person's own pick in the pane goes over all of these.
 */
export async function themeFor(
  $: EngineInterface,
  track: Track | null,
  context: string | undefined,
  playlistName: string | null,
  useGenres: boolean,
): Promise<Choice> {
  if (context) {
    const theme = (await playlistThemes($))[context]
    if (theme) return { auto: theme, reason: 'playlist', basis: playlistName ?? '' }
  }
  const names = artistsOf(track)
  if (names.length > 0) {
    const artists = await artistThemes($)
    for (const name of names) {
      const theme = artists[nameKey(name)]
      if (theme) return { auto: theme, reason: 'artist', basis: name }
    }
  }
  const named = playlistName ? themeOfName(playlistName) : null
  if (named && playlistName) return { auto: named, reason: 'playlistName', basis: playlistName }
  if (useGenres && names.length > 0) {
    const genres = await genreCache($)
    for (const name of names) {
      const theme = genres[nameKey(name)]
      if (theme) return { auto: theme, reason: 'musicbrainz', basis: name }
    }
  }
  return { auto: 'nightdrive', reason: 'default', basis: '' }
}

/* ── MusicBrainz, only when the person opted in ───────────────────────── */

const MUSICBRAINZ = 'https://musicbrainz.org/ws/2'
// MusicBrainz asks each client to name itself and to ask once a second at most.
const AGENT = 'PixelTunes/0.1.0 ( https://github.com/tijshuisman/claude-pixel-tunes )'
const GAP_MS = 1_100

let nextAt = 0
let line: Promise<unknown> = Promise.resolve()

/** One request at a time, 1.1 s apart, longer while MusicBrainz is busy; null when it knows nothing. */
async function musicbrainz($: EngineInterface, path: string): Promise<unknown> {
  const turn = line.then(() => ask($, path))
  line = turn.catch(() => undefined)
  return turn
}

async function ask($: EngineInterface, path: string): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = nextAt - (await $.clock.now())
    if (wait > 0) await $.clock.sleep(wait)
    nextAt = (await $.clock.now()) + GAP_MS
    const res = await $.http.fetch(`${MUSICBRAINZ}${path}`, { headers: { 'User-Agent': AGENT, Accept: 'application/json' } })
    if (res.status === 404) return null
    if (res.status === 503 || res.status === 429) {
      nextAt += 2_000 * 2 ** attempt
      continue
    }
    if (!res.ok) throw new Error(`MusicBrainz answered ${res.status}`)
    return JSON.parse(res.text) as unknown
  }
  throw new Error('MusicBrainz is too busy')
}

type Credit = { name?: string; artist?: { id?: string; name?: string } }
type Genre = { name?: string; count?: number }

/**
 * Looks up the family of a track's artist at MusicBrainz, through the
 * track's ISRC, never its name (a band named after a common word can turn
 * out to be a composer), and keeps the answer in the store, so each artist
 * is asked about once.
 */
export async function lookUpGenre($: EngineInterface, track: Track): Promise<void> {
  const isrc = track.isrc?.toUpperCase() ?? ''
  const keys = artistsOf(track).map(nameKey)
  if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) || keys.length === 0) return
  const cache = await genreCache($)
  if (keys.some(key => key in cache)) return

  const found = (await musicbrainz($, `/isrc/${isrc}?inc=artist-credits&fmt=json`)) as { recordings?: { 'artist-credit'?: Credit[] }[] } | null
  const credits = (found?.recordings ?? []).flatMap(r => r['artist-credit'] ?? [])
  const credit = credits.find(c => keys.includes(nameKey(c.artist?.name ?? c.name ?? ''))) ?? credits[0]
  const creditKey = nameKey(credit?.artist?.name ?? credit?.name ?? '')
  const key = keys.includes(creditKey) ? creditKey : (keys[0] ?? creditKey)
  let theme: ThemeId | null = null
  const id = credit?.artist?.id ?? ''
  if (/^[0-9a-f-]{36}$/.test(id)) {
    const artist = (await musicbrainz($, `/artist/${id}?inc=genres+tags&fmt=json`)) as { genres?: Genre[]; tags?: Genre[] } | null
    const listed = artist?.genres?.length ? artist.genres : (artist?.tags ?? [])
    theme = themeOfGenres(listed.flatMap(g => (typeof g.name === 'string' ? [{ name: g.name, count: g.count ?? 0 }] : [])))
  }
  await $.store.set(GENRES, { ...(await genreCache($)), [key]: theme })
}
