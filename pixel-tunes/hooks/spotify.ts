import type { EngineInterface } from 'claude-code'

import type { Device, Item, Playback, RepeatMode, Track } from '../types'

// The Spotify side: logging in (Authorization Code with PKCE, so no client
// secret), the tokens (the access token in memory, the refresh token in the
// macOS Keychain) and the Web API calls the player needs. Everything goes
// through the engine: $.http.fetch for the network, $.process.run for the
// browser, the Keychain and the one-shot login callback server.

const ACCOUNTS = 'https://accounts.spotify.com'
const API = 'https://api.spotify.com/v1'
const KEYCHAIN = ['-s', 'claude-pixel-tunes', '-a', 'spotify-refresh-token']

export const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-recently-played',
]

export class SpotifyError extends Error {
  status: number
  reason: string | undefined
  constructor(status: number, message: string, reason?: string) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

/* ── configuration and tokens ─────────────────────────────────────────── */

let clientId = ''
let port = 8898

export function configure(id: string, callbackPort: number): void {
  clientId = id.trim()
  port = callbackPort
}

/** Whether a Spotify Client ID is set; without one there is only the demo. */
export function hasClientId(): boolean {
  return clientId !== ''
}

const redirectUri = () => `http://127.0.0.1:${port}/callback`

type Tokens = { access: string; expiresAt: number; refresh: string }

// Module memory: a reload starts over from the Keychain.
let tokens: Tokens | undefined
let pending: { verifier: string; state: string } | undefined
let refreshing: Promise<string> | undefined
let blockedUntil = 0
// How long Spotify last asked to wait, in seconds; 0 when it never did.
let breakAsked = 0

// Spotify may ask for a break of hours: as long as it asks, up to a day.
const MAX_BREAK_S = 86_400

export const isSignedIn = () => tokens !== undefined

/** Until when Spotify asked for a break, and for how many seconds; null when it never did. */
export function lastBreak(): { until: number; asked: number } | null {
  return breakAsked ? { until: blockedUntil, asked: breakAsked } : null
}

/** A moment as a clock on the wall shows it, to the minute after: "14:32", or "tomorrow 14:32". */
export function clockTime(ms: number, now: number): string {
  const at = new Date(Math.ceil(ms / 60_000) * 60_000)
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return at.toDateString() === new Date(now).toDateString() ? time : `tomorrow ${time}`
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function keychainRead($: EngineInterface): Promise<string | null> {
  const run = await $.process.run(['/usr/bin/security', 'find-generic-password', ...KEYCHAIN, '-w'])
  const token = run.stdout.trim()
  return run.exitCode === 0 && token ? token : null
}

async function keychainWrite($: EngineInterface, token: string): Promise<void> {
  const run = await $.process.run(['/usr/bin/security', 'add-generic-password', '-U', ...KEYCHAIN, '-w', token])
  if (run.exitCode !== 0) throw new SpotifyError(0, 'Could not save the Spotify token in the Keychain.')
}

async function keychainDelete($: EngineInterface): Promise<void> {
  await $.process.run(['/usr/bin/security', 'delete-generic-password', ...KEYCHAIN])
}

async function tokenRequest($: EngineInterface, params: Record<string, string>): Promise<Tokens> {
  const res = await $.http.fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, ...params }).toString(),
  })
  const json = parse(res.text) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  } | null
  if (!res.ok || !json?.access_token)
    throw new SpotifyError(res.status, json?.error_description ?? json?.error ?? `Spotify answered ${res.status}`, json?.error)
  const now = await $.clock.now()
  return {
    access: json.access_token,
    refresh: json.refresh_token ?? params['refresh_token'] ?? '',
    expiresAt: now + ((json.expires_in ?? 3600) - 60) * 1000,
  }
}

async function accessToken($: EngineInterface): Promise<string> {
  const current = tokens
  if (!current) throw new SpotifyError(401, 'Not connected to Spotify.')
  if (current.access && (await $.clock.now()) < current.expiresAt) return current.access
  refreshing ??= (async () => {
    try {
      // Every session shares the Keychain's token; another may have rotated it.
      let refresh = (await keychainRead($)) ?? current.refresh
      let next: Tokens
      try {
        next = await tokenRequest($, { grant_type: 'refresh_token', refresh_token: refresh })
      } catch (error) {
        // Rotated between our read and our request: try the newest once more.
        const latest = error instanceof SpotifyError && error.reason === 'invalid_grant' ? await keychainRead($) : null
        if (!latest || latest === refresh) throw error
        refresh = latest
        next = await tokenRequest($, { grant_type: 'refresh_token', refresh_token: refresh })
      }
      tokens = next
      if (next.refresh && next.refresh !== refresh) await keychainWrite($, next.refresh)
      return next.access
    } finally {
      refreshing = undefined
    }
  })()
  return refreshing
}

/* ── logging in ───────────────────────────────────────────────────────── */

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

function randomText(length: number): string {
  return [...crypto.getRandomValues(new Uint8Array(length))].map(b => UNRESERVED[b % UNRESERVED.length] ?? 'x').join('')
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  let binary = ''
  for (const b of digest) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A new login: the page to send the person to. */
export async function beginLogin(): Promise<{ url: string; state: string }> {
  if (!clientId) throw new SpotifyError(0, 'No Spotify Client ID is set yet. The README of Pixel Tunes explains how to make one.')
  const verifier = randomText(64)
  const state = randomText(24)
  pending = { verifier, state }
  const query = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challengeOf(verifier),
    state,
    scope: SCOPES.join(' '),
  })
  return { url: `${ACCOUNTS}/authorize?${query.toString()}`, state }
}

export const cancelLogin = () => {
  pending = undefined
}

// A one-shot server for the redirect: threaded, so an idle speculative
// connection from the browser cannot hold it up; gone after five minutes.
const CALLBACK_SERVER = `
import sys, threading, urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
port, state, page = int(sys.argv[1]), sys.argv[2], sys.argv[3].encode()
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        query = urllib.parse.parse_qs(url.query)
        if url.path != '/callback' or query.get('state', [''])[0] != state:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(page)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(page)
        print(url.query, flush=True)
        threading.Thread(target=self.server.shutdown, daemon=True).start()
    def log_message(self, *args):
        pass
server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
server.daemon_threads = True
timer = threading.Timer(300, server.shutdown)
timer.daemon = True
timer.start()
server.serve_forever()
`

const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>Pixel Tunes</title>' +
  '<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d0221;color:#ff2a6d;font:700 24px ui-monospace,Menlo,monospace">' +
  '<div style="text-align:center">PIXEL TUNES<div style="color:#9d86c9;font:400 15px system-ui,sans-serif;margin-top:14px">Connected to Spotify. You can close this tab.</div></div></body>'

/** Waits for the browser's redirect; `failedFast` when no server could listen. */
export async function listen($: EngineInterface, state: string): Promise<{ params: URLSearchParams | null; failedFast: boolean }> {
  const started = await $.clock.now()
  try {
    const run = await $.process.run(['/usr/bin/python3', '-c', CALLBACK_SERVER, String(port), state, DONE_PAGE], { timeoutMs: 305_000 })
    const line = run.stdout.trim().split('\n').pop() ?? ''
    if (run.exitCode === 0 && line) return { params: new URLSearchParams(line), failedFast: false }
  } catch {
    // python3 missing or the call timed out: fall through
  }
  return { params: null, failedFast: (await $.clock.now()) - started < 10_000 }
}

/** Ends a login with the redirect's query: tokens kept, the refresh token in the Keychain. */
export async function finishLogin($: EngineInterface, params: URLSearchParams): Promise<void> {
  const wanted = pending
  if (!wanted) throw new SpotifyError(0, 'No login is in progress; start again.')
  if (params.get('state') !== wanted.state) throw new SpotifyError(0, 'This URL does not belong to the last login; start again.')
  const error = params.get('error')
  if (error) throw new SpotifyError(0, error === 'access_denied' ? 'You did not give Pixel Tunes access.' : `Spotify says: ${error}`)
  const code = params.get('code')
  if (!code) throw new SpotifyError(0, 'The URL has no code in it.')
  tokens = await tokenRequest($, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: wanted.verifier,
  })
  pending = undefined
  await keychainWrite($, tokens.refresh)
}

/** Picks up a login from an earlier session; false when there is none. */
export async function resume($: EngineInterface): Promise<boolean> {
  const refresh = await keychainRead($)
  if (!refresh) return false
  tokens = { access: '', expiresAt: 0, refresh }
  try {
    await accessToken($)
    return true
  } catch (error) {
    tokens = undefined
    throw error
  }
}

export async function logout($: EngineInterface): Promise<void> {
  forget()
  await keychainDelete($)
}

/** Drops this session's tokens but leaves the Keychain: another session may hold a newer one. */
export function forget(): void {
  tokens = undefined
  pending = undefined
}

/* ── the Web API ──────────────────────────────────────────────────────── */

async function api($: EngineInterface, method: string, path: string, body?: unknown): Promise<unknown> {
  const now = await $.clock.now()
  const onBreak = () => new SpotifyError(429, `Spotify asks for a break until ${clockTime(blockedUntil, now)}.`)
  if (now < blockedUntil) throw onBreak()
  const send = async () =>
    $.http.fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken($)}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  let res = await send()
  if (res.status === 401 && tokens) {
    tokens = { ...tokens, access: '' }
    res = await send()
  }
  if (res.status === 429) {
    const wait = Number(res.headers['retry-after'] ?? '10')
    breakAsked = Number.isFinite(wait) && wait > 0 ? wait : 10
    blockedUntil = now + Math.min(breakAsked, MAX_BREAK_S) * 1000
    throw onBreak()
  }
  if (!res.ok) {
    const json = parse(res.text) as { error?: { message?: string; reason?: string } | string } | null
    const error = typeof json?.error === 'object' ? json.error : undefined
    throw new SpotifyError(res.status, error?.message ?? `Spotify answered ${res.status}`, error?.reason)
  }
  return res.text ? parse(res.text) : null
}

type RawImage = { url: string; width?: number | null }
type RawItem = {
  id: string
  uri: string
  name: string
  duration_ms: number
  external_ids?: { isrc?: string }
  artists?: { name: string; id?: string | null; uri?: string }[]
  album?: { uri?: string; name: string; images?: RawImage[] }
  show?: { name: string; images?: RawImage[] }
  images?: RawImage[]
}
type RawPlaylist = {
  uri: string
  name: string
  owner?: { display_name?: string | null }
  // Renamed from `tracks` in February 2026; either may come.
  items?: { total?: number }
  tracks?: { total?: number }
}
type RawSearch = {
  tracks?: { items?: (RawItem | null)[] }
  albums?: { items?: ({ uri: string; name: string; artists?: { name: string }[]; release_date?: string } | null)[] }
  playlists?: { items?: (RawPlaylist | null)[] }
  artists?: { items?: ({ uri: string; name: string; genres?: string[] } | null)[] }
}
type RawPlayback = {
  device?: { name?: string; volume_percent?: number | null } | null
  shuffle_state?: boolean
  repeat_state?: string
  progress_ms?: number | null
  is_playing?: boolean
  item?: RawItem | null
  context?: { uri?: string } | null
}

/**
 * The artwork nearest 300 px: sharp at 56 px on a retina screen, and small. One of
 * unknown width comes after any whose width is known: Spotify lists the widest first.
 */
export function pickImage(images: readonly RawImage[] | undefined): string | undefined {
  if (!images?.length) return undefined
  const near = (i: RawImage) => (i.width ? Math.abs(i.width - 300) : Number.MAX_SAFE_INTEGER)
  return [...images].sort((a, b) => near(a) - near(b))[0]?.url
}

export function toTrack(item: RawItem): Track {
  const credited = (item.artists ?? []).filter(a => a.name)
  const artists = credited.map(a => a.name)
  const artistIds = credited.map(a => a.id ?? a.uri?.split(':')[2] ?? '')
  const isrc = item.external_ids?.isrc
  return {
    id: item.id,
    uri: item.uri,
    title: item.name,
    artist: artists.join(', ') || item.show?.name || '',
    album: item.album?.name ?? item.show?.name ?? '',
    durationMs: item.duration_ms,
    imageUrl: pickImage(item.album?.images ?? item.images ?? item.show?.images),
    ...(artists.length > 0 ? { artists, artistIds } : {}),
    ...(isrc ? { isrc } : {}),
  }
}

/** Spotify's playback state as ours; null (204, nothing active) is silence. */
export function toPlayback(raw: RawPlayback | null, now: number, before: Playback): Playback {
  if (!raw?.item) return { ...before, track: null, isPlaying: false, positionMs: 0, at: now, device: raw?.device?.name ?? '' }
  const repeat: RepeatMode = raw.repeat_state === 'track' || raw.repeat_state === 'context' ? raw.repeat_state : 'off'
  const context = raw.context?.uri
  return {
    track: toTrack(raw.item),
    isPlaying: raw.is_playing === true,
    positionMs: raw.progress_ms ?? 0,
    at: now,
    shuffle: raw.shuffle_state === true,
    repeat,
    volume: raw.device?.volume_percent ?? before.volume,
    device: raw.device?.name ?? '',
    ...(context ? { context } : {}),
  }
}

const names = (artists: readonly { name: string }[] | undefined) => (artists ?? []).map(a => a.name).filter(Boolean).join(', ')

function playlistLine(p: RawPlaylist): string {
  const total = p.items?.total ?? p.tracks?.total
  const owner = p.owner?.display_name
  // The size first: when a row is cut short, the owner goes.
  return [typeof total === 'number' ? `${total} tracks` : '', owner ? `by ${owner}` : ''].filter(Boolean).join(' · ')
}

const playlistItem = (p: RawPlaylist): Item => ({ kind: 'playlist', uri: p.uri, title: p.name, subtitle: playlistLine(p) })

/** Search results as things to play: tracks (in their album), albums, playlists, artists. */
export function toSearchItems(json: RawSearch | null): Item[] {
  const items: Item[] = []
  for (const t of json?.tracks?.items ?? [])
    if (t?.uri) items.push({ kind: 'track', uri: t.uri, title: t.name, subtitle: names(t.artists), ...(t.album?.uri ? { context: t.album.uri } : {}) })
  for (const a of json?.albums?.items ?? [])
    if (a?.uri) items.push({ kind: 'album', uri: a.uri, title: a.name, subtitle: [names(a.artists), a.release_date?.slice(0, 4)].filter(Boolean).join(' · ') })
  // Spotify's playlist results can hold nulls.
  for (const p of json?.playlists?.items ?? []) if (p?.uri) items.push(playlistItem(p))
  for (const a of json?.artists?.items ?? [])
    if (a?.uri) items.push({ kind: 'artist', uri: a.uri, title: a.name, subtitle: a.genres?.slice(0, 2).join(', ') ?? '' })
  return items
}

export async function search($: EngineInterface, query: string): Promise<Item[]> {
  const params = new URLSearchParams({ q: query, type: 'track,album,playlist,artist', limit: '4' })
  return toSearchItems((await api($, 'GET', `/search?${params.toString()}`)) as RawSearch | null)
}

/** A playlist's name, from its `spotify:playlist:<id>` URI, to choose the scene by; null when Spotify gives none. */
export async function playlistName($: EngineInterface, uri: string): Promise<string | null> {
  const [, kind, id] = uri.split(':')
  if (kind !== 'playlist' || !id || !/^[A-Za-z0-9]+$/.test(id)) return null
  const json = (await api($, 'GET', `/playlists/${id}?fields=name`)) as { name?: unknown } | null
  return typeof json?.name === 'string' && json.name ? json.name : null
}

/** The playlists you own or follow, twenty at a time. */
export async function myPlaylists($: EngineInterface, offset: number): Promise<{ items: Item[]; hasMore: boolean }> {
  const json = (await api($, 'GET', `/me/playlists?limit=20&offset=${offset}`)) as { items?: (RawPlaylist | null)[]; next?: string | null } | null
  return {
    items: (json?.items ?? []).filter((p): p is RawPlaylist => typeof p?.uri === 'string').map(playlistItem),
    hasMore: typeof json?.next === 'string',
  }
}

/** What you played lately, each track once, with the context it played in. */
export async function recentlyPlayed($: EngineInterface): Promise<Item[]> {
  const json = (await api($, 'GET', '/me/player/recently-played?limit=30')) as {
    items?: { track?: RawItem | null; context?: { uri?: string } | null }[]
  } | null
  const seen = new Set<string>()
  const items: Item[] = []
  for (const { track, context } of json?.items ?? []) {
    if (!track?.uri || seen.has(track.uri)) continue
    seen.add(track.uri)
    const where = context?.uri ?? track.album?.uri
    items.push({ kind: 'track', uri: track.uri, title: track.name, subtitle: names(track.artists), ...(where ? { context: where } : {}) })
  }
  return items.slice(0, 15)
}

export async function enqueue($: EngineInterface, uri: string): Promise<void> {
  await api($, 'POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`)
}

export async function playbackState($: EngineInterface): Promise<RawPlayback | null> {
  return (await api($, 'GET', '/me/player?additional_types=episode')) as RawPlayback | null
}

/** What plays now and the next four. */
export async function upcoming($: EngineInterface): Promise<Track[]> {
  const json = (await api($, 'GET', '/me/player/queue')) as { currently_playing?: RawItem | null; queue?: RawItem[] } | null
  return [json?.currently_playing, ...(json?.queue ?? [])]
    .filter((item): item is RawItem => typeof item?.id === 'string')
    .slice(0, 5)
    .map(toTrack)
}

export async function devices($: EngineInterface): Promise<Device[]> {
  const json = (await api($, 'GET', '/me/player/devices')) as {
    devices?: { id: string | null; name: string; type: string; is_active: boolean; is_restricted?: boolean }[]
  } | null
  return (json?.devices ?? [])
    .filter(d => typeof d.id === 'string' && !d.is_restricted)
    .map(d => ({ id: d.id ?? '', name: d.name, type: d.type, isActive: d.is_active }))
}

export async function transfer($: EngineInterface, id: string, play: boolean): Promise<void> {
  await api($, 'PUT', '/me/player', { device_ids: [id], play })
}

export async function profile($: EngineInterface): Promise<string> {
  const json = (await api($, 'GET', '/me')) as { display_name?: string | null; id?: string } | null
  return json?.display_name || json?.id || 'Spotify'
}

export async function isSaved($: EngineInterface, uri: string): Promise<boolean> {
  const json = await api($, 'GET', `/me/library/contains?uris=${encodeURIComponent(uri)}`)
  return Array.isArray(json) && json[0] === true
}

export async function setSaved($: EngineInterface, uri: string, saved: boolean): Promise<void> {
  await api($, saved ? 'PUT' : 'DELETE', `/me/library?uris=${encodeURIComponent(uri)}`)
}

/** `device` names a Spotify Connect device to play on; left out, the active one plays. */
export type Control =
  | { kind: 'resume' }
  | { kind: 'play'; uri: string; context?: string; device?: string }
  | { kind: 'context'; context: string; device?: string }
  | { kind: 'pause' }
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'shuffle'; on: boolean }
  | { kind: 'repeat'; mode: RepeatMode }
  | { kind: 'volume'; percent: number }

const playOn = (device: string | undefined) => `/me/player/play${device ? `?device_id=${encodeURIComponent(device)}` : ''}`

export async function control($: EngineInterface, c: Control): Promise<void> {
  switch (c.kind) {
    case 'resume':
      await api($, 'PUT', '/me/player/play')
      return
    case 'play':
      await api($, 'PUT', playOn(c.device), c.context ? { context_uri: c.context, offset: { uri: c.uri } } : { uris: [c.uri] })
      return
    case 'context':
      await api($, 'PUT', playOn(c.device), { context_uri: c.context })
      return
    case 'pause':
      await api($, 'PUT', '/me/player/pause')
      return
    case 'next':
      await api($, 'POST', '/me/player/next')
      return
    case 'prev':
      await api($, 'POST', '/me/player/previous')
      return
    case 'shuffle':
      await api($, 'PUT', `/me/player/shuffle?state=${c.on}`)
      return
    case 'repeat':
      await api($, 'PUT', `/me/player/repeat?state=${c.mode}`)
      return
    case 'volume':
      await api($, 'PUT', `/me/player/volume?volume_percent=${Math.round(c.percent)}`)
      return
  }
}

// Spotify's image hosts: i.scdn.co, mosaic.scdn.co and the *.spotifycdn.com CDNs.
const ARTWORK_HOST = /^(?:i|mosaic)\.scdn\.co$|^[a-z0-9-]+\.spotifycdn\.com$/

/** A fetched cover, or why there is none, in words for `/tunes debug`. */
export type ArtworkResult = { dataUri: string | null; note: string }

/** An address's scheme and host, never its path: it names a server, not what it serves. */
export function originOf(url: string | undefined): string {
  if (!url) return 'none'
  try {
    return new URL(url).origin
  } catch {
    return 'no valid address'
  }
}

// The largest cover the pane takes, in base64 characters: its Svg may be at most 131,072.
const MAX_COVER = 120_000

// The cover downloaded and shrunk to 300 px, about what a wide pane draws on a retina screen.
const SHRINK = [
  't=$(/usr/bin/mktemp -d) || exit 1',
  `trap '/bin/rm -rf "$t"' EXIT`,
  '/usr/bin/curl -fsSL --max-time 10 -o "$t/cover" "$1" &&',
  '/usr/bin/sips -s format jpeg -s formatOptions 80 -Z 300 "$t/cover" --out "$t/small.jpg" >/dev/null &&',
  '/usr/bin/base64 < "$t/small.jpg"',
].join('\n')

/**
 * The artwork as a data URI: the Svg may not fetch on its own. Only Spotify's
 * image hosts, over https; the shell gets the URL as an argument, never as code.
 * A cover too large for the pane is fetched once more and shrunk.
 */
export async function artworkDataUri($: EngineInterface, url: string): Promise<ArtworkResult> {
  let host = ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') host = parsed.hostname
  } catch {
    // not a URL: host stays empty
  }
  if (!ARTWORK_HOST.test(host)) return { dataUri: null, note: `skipped, not a Spotify image server: ${originOf(url)}` }
  try {
    const run = await $.process.run(
      ['/bin/sh', '-c', '/usr/bin/curl -fsSL --max-time 10 "$1" | /usr/bin/base64', 'pixel-tunes', url],
      { timeoutMs: 15_000 },
    )
    const data = run.stdout.replace(/\s+/g, '')
    if (data.length < 100) return { dataUri: null, note: `download failed: ${run.stderr.trim().slice(0, 200) || `exit ${run.exitCode}, no data`}` }
    if (data.length > MAX_COVER) {
      const large = `${Math.round(data.length / 1024)} KB base64`
      const shrunk = await $.process.run(['/bin/sh', '-c', SHRINK, 'pixel-tunes', url], { timeoutMs: 20_000 })
      const small = shrunk.stdout.replace(/\s+/g, '')
      if (small.length < 100 || small.length > MAX_COVER)
        return { dataUri: null, note: `cover too large for the pane (${large}), and shrinking it failed: ${shrunk.stderr.trim().slice(0, 200) || `exit ${shrunk.exitCode}`}` }
      return { dataUri: `data:image/jpeg;base64,${small}`, note: `fetched from ${host} and shrunk to 300 px (${large}, now ${Math.round(small.length / 1024)} KB)` }
    }
    const mime = data.startsWith('iVBOR') ? 'image/png' : data.startsWith('UklGR') ? 'image/webp' : 'image/jpeg'
    return { dataUri: `data:${mime};base64,${data}`, note: `fetched from ${host} (${Math.round(data.length / 1024)} KB, ${mime})` }
  } catch (error) {
    return { dataUri: null, note: `download failed: ${error instanceof Error ? error.message : 'unknown error'}` }
  }
}

/** Opens a URL or an app (`-a Spotify`) the way the Finder would. */
export async function openOnMac($: EngineInterface, ...args: string[]): Promise<boolean> {
  try {
    return (await $.process.run(['/usr/bin/open', ...args])).exitCode === 0
  } catch {
    return false
  }
}
