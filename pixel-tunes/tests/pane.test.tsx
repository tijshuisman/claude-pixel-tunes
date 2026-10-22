import { expect, mock, test } from 'claude-code/testing'
import type { On, RegisteredToolSpec } from 'claude-code'

import { themeOfGenres, themeOfName } from '../hooks/genre'
import { scenePixels, sceneCells } from '../hooks/raster'
import { glyphs, scene, strip } from '../hooks/render'
import { toPlayback, toSearchItems } from '../hooks/spotify'
import { THEMES, THEME_IDS } from '../hooks/themes'

const PANE = {
  plugin: 'pixel-tunes',
  component: 'Pane',
  requestId: 'pixel-tunes',
  props: {
    title: 'Pixel Tunes',
    isFocused: false,
    bodyColumns: 30,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SPINNER = {
  plugin: 'pixel-tunes',
  component: 'Spinner',
  props: { word: 'Thinking', message: null, suffix: '…', mode: 'thinking' },
} as const

// The band above the prompt, while Claude works.
const BAND = {
  plugin: 'pixel-tunes',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

const PLAY_MUSIC = 'mcp__pixel-tunes__play_music'

/** The drawings in a mounted pane, without the empty spacer above the scene. */
const art = async (ui: { findAll: (q: { type: 'Svg' }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.alt !== '')

// A Spotify Client ID, as the person sets it; without one there is only the demo.
const CLIENT = { options: { spotify_client_id: 'test-client' } }

// Nothing sits beneath the plugin: these hooks stand for the engine.
function engine(
  on: On,
  {
    takesTools = true,
    store = {},
    isFocused = () => false,
    isOpen = true,
  }: { takesTools?: boolean; store?: Record<string, unknown>; isFocused?: () => boolean; isOpen?: boolean } = {},
) {
  const tools: RegisteredToolSpec[] = []
  const opened: string[] = []
  // The panes up now: the player's, unless the test starts with it closed.
  const up = new Set<string>(isOpen ? ['pixel-tunes'] : [])
  mock.store(on, store)
  on('command.register', () => ({ value: { command: 'tunes' } }))
  on('tool.register', (_, e) => {
    if (!takesTools) return { deny: 'this session takes no tools from plugins' }
    tools.push(e)
    return { value: { tool: `mcp__pixel-tunes__${e.name}` } }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    up.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [...up].map(id => ({ id, title: 'Pixel Tunes', isShown: true, isFocused: isFocused(), isPlaced: true })) }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  return { tools, opened }
}

/** The engine's own spinner line beneath the plugin: its word, then what follows. */
function spinnerLine(on: On): void {
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`${e.props.word}${e.props.suffix}`}</Text>
  })
}

/** The engine's own band beneath the plugin: empty until a mod fills it. */
function emptyBand(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

const ran = (exitCode: number, stdout = '') => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

const IMAGE = `https://i.scdn.co/image/ab67616d00001e02${'0a'.repeat(12)}`

const track = (id: string, name: string, artist: string, image = IMAGE) => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  duration_ms: 258_000,
  artists: [{ name: artist }],
  album: { name: 'OutRun', images: [{ url: image, width: 300 }] },
})

/** A track with its artists each on their own, and an ISRC when given. */
const song = (id: string, name: string, artists: string[], isrc?: string) => ({
  ...track(id, name, artists.join(', ')),
  artists: artists.map(artist => ({ name: artist })),
  ...(isrc ? { external_ids: { isrc } } : {}),
})

type MusicBrainz = {
  /** Per ISRC, the artist MusicBrainz credits. */
  recordings: Record<string, { id: string; name: string }>
  /** Per artist id, its genres with their votes. */
  genres: Record<string, { name: string; count: number }[]>
  /** Per Spotify artist page, the artist MusicBrainz links to it. */
  spotifyPages?: Record<string, { id: string; name: string }>
  /** Unreachable: every request is refused, its address (and so the ISRC) in the reason. */
  isDown?: boolean
}

/** Spotify, the Keychain, the browser and the shell, in memory. */
function fakeSpotify(
  on: On,
  start: {
    keychain?: string
    isPlaying?: boolean
    noDevice?: boolean
    soleDevice?: boolean
    image?: string
    current?: ReturnType<typeof track>
    context?: string
    /** Where the track is when Spotify is asked, in ms; a minute in when not given. */
    progress?: () => number
    /** Playlist names by id, for `GET /playlists/{id}`. */
    playlists?: Record<string, string>
    musicbrainz?: MusicBrainz
  } = {},
) {
  const calls: { method: string; url: string; body?: string; headers?: Record<string, string> }[] = []
  const downloads: string[] = []
  const revoked = new Set<string>()
  let issued = 1
  let keychain: string | null = start.keychain ?? null
  let current = start.current ?? track('4ZvOq2Y5k8qy3x1vFqJq8x', 'Nightcall', 'Kavinsky', start.image)
  let context = start.context ?? 'spotify:playlist:37i9dQZF1DX6GJXiuZRisr'
  let isPlaying = start.isPlaying ?? true

  on('process.run', (_, e) => {
    const [command, sub] = e.argv
    if (command === '/usr/bin/security') {
      if (sub === 'find-generic-password') return keychain ? ran(0, `${keychain}\n`) : ran(44)
      if (sub === 'add-generic-password') keychain = e.argv[e.argv.length - 1] ?? null
      if (sub === 'delete-generic-password') keychain = null
      return ran(0)
    }
    // The login's callback server: the browser came back with a code.
    if (command === '/usr/bin/python3') return ran(0, `code=the-code&state=${e.argv[4] ?? ''}\n`)
    // The artwork, base64 (a JPEG starts /9j/).
    if (command === '/bin/sh') {
      downloads.push(e.argv[e.argv.length - 1] ?? '')
      return ran(0, `/9j/${'A'.repeat(400)}\n`)
    }
    return ran(0)
  })

  on('http.fetch', (_, e) => {
    const method = e.init?.method ?? 'GET'
    calls.push({ method, url: e.url, ...(e.init?.body ? { body: e.init.body } : {}), ...(e.init?.headers ? { headers: e.init.headers } : {}) })
    const answer = (status: number, body?: unknown) => ({
      value: { status, ok: status >= 200 && status < 300, headers: {}, text: body === undefined ? '' : JSON.stringify(body) },
    })
    const url = new URL(e.url)
    if (url.host === 'musicbrainz.org') {
      if (start.musicbrainz?.isDown) return { deny: `refused: ${e.url}` }
      const [, , , kind, id] = url.pathname.split('/')
      const artist = kind === 'isrc' ? start.musicbrainz?.recordings[id ?? ''] : undefined
      if (artist) return answer(200, { isrc: id, recordings: [{ id: 'rec', 'artist-credit': [{ name: artist.name, artist }] }] })
      const page = url.searchParams.get('resource') ?? ''
      const linked = kind === 'url' ? start.musicbrainz?.spotifyPages?.[page] : undefined
      if (linked) return answer(200, { resource: page, relations: [{ type: 'free streaming', 'target-type': 'artist', artist: linked }] })
      const genres = kind === 'artist' ? start.musicbrainz?.genres[id ?? ''] : undefined
      if (genres) return answer(200, { id, genres, tags: [{ name: 'seen live', count: 9 }] })
      return answer(404, { error: 'Not Found' })
    }
    if (method === 'GET' && url.pathname.startsWith('/v1/playlists/')) {
      const name = start.playlists?.[url.pathname.split('/')[3] ?? '']
      return name ? answer(200, { name }) : answer(404, { error: { status: 404, message: 'Resource not found' } })
    }
    if (url.host === 'accounts.spotify.com') {
      const used = new URLSearchParams(e.init?.body ?? '').get('refresh_token')
      if (used && revoked.has(used)) return answer(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' })
      // Each token request hands out a new refresh token: refresh-2, refresh-3, …
      issued += 1
      return answer(200, { access_token: `access-${issued}`, refresh_token: `refresh-${issued}`, expires_in: 3600 })
    }
    switch (`${method} ${url.pathname}`) {
      case 'GET /v1/me':
        return answer(200, { display_name: 'Testluisteraar' })
      case 'GET /v1/me/player':
        return start.noDevice
          ? answer(204)
          : answer(200, {
              device: { name: 'MacBook Pro', volume_percent: 70 },
              shuffle_state: false,
              repeat_state: 'off',
              progress_ms: start.progress?.() ?? 60_000,
              is_playing: isPlaying,
              item: current,
              context: { uri: context },
            })
      case 'GET /v1/me/player/queue':
        return answer(200, { currently_playing: current, queue: [track('2', 'Odd Look', 'Kavinsky')] })
      case 'GET /v1/me/library/contains':
        return answer(200, [true])
      case 'POST /v1/me/player/next':
        current = track('5', 'Tech Noir', 'Gunship')
        return answer(204)
      case 'PUT /v1/me/player/pause':
        isPlaying = false
        return answer(204)
      case 'PUT /v1/me/player/play':
        // With no device active, only a play on a named device goes through.
        if (start.noDevice && !url.searchParams.has('device_id'))
          return answer(404, { error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } })
        isPlaying = true
        return answer(204)
      case 'PUT /v1/me/player':
        return answer(204)
      case 'POST /v1/me/player/queue':
        return answer(204)
      case 'GET /v1/search':
        if (url.searchParams.get('q') === 'nothing') return answer(200, { tracks: { items: [] }, albums: { items: [] }, playlists: { items: [] }, artists: { items: [] } })
        return answer(200, {
          tracks: { items: [{ ...track('nc1', 'Nightcall', 'Kavinsky'), album: { uri: 'spotify:album:outrun', name: 'OutRun' } }] },
          albums: { items: [{ uri: 'spotify:album:outrun', name: 'OutRun', artists: [{ name: 'Kavinsky' }], release_date: '2013-02-22' }] },
          // Spotify's playlist results can hold nulls.
          playlists: { items: [null, { uri: 'spotify:playlist:drive', name: 'Night Drive', owner: { display_name: 'Ana' }, items: { total: 42 } }] },
          artists: { items: [{ uri: 'spotify:artist:kavinsky', name: 'Kavinsky', genres: ['synthwave', 'french house'] }] },
        })
      case 'GET /v1/me/playlists':
        return url.searchParams.get('offset') === '0'
          ? answer(200, {
              items: [
                { uri: 'spotify:playlist:a', name: 'Coding at 3am', owner: { display_name: 'Testluisteraar' }, tracks: { total: 12 } },
                { uri: 'spotify:playlist:b', name: 'Outrun', owner: { display_name: 'Testluisteraar' }, items: { total: 7 } },
              ],
              next: 'https://api.spotify.com/v1/me/playlists?offset=20&limit=20',
            })
          : answer(200, { items: [{ uri: 'spotify:playlist:c', name: 'Retro', owner: { display_name: 'Ana' } }], next: null })
      case 'GET /v1/me/player/recently-played':
        return answer(200, {
          items: [
            { track: track('t1', 'Turbo Killer', 'Carpenter Brut'), context: { uri: 'spotify:playlist:a' } },
            { track: track('t1', 'Turbo Killer', 'Carpenter Brut'), context: { uri: 'spotify:playlist:a' } },
            { track: { ...track('t2', 'Resonance', 'Home'), album: { uri: 'spotify:album:odyssey', name: 'Odyssey' } }, context: null },
            { track: track('t3', 'Zenith', 'Kavinsky, Olivia Merilahti, Morgan Phalen'), context: null },
          ],
        })
      case 'GET /v1/me/player/devices':
        return answer(200, {
          devices: [
            { id: 'mac', name: 'MacBook Pro', type: 'Computer', is_active: false },
            ...(start.soleDevice ? [] : [{ id: 'phone', name: 'iPhone', type: 'Smartphone', is_active: false }]),
          ],
        })
      default:
        return answer(404, { error: { status: 404, message: 'Not found' } })
    }
  })

  return {
    calls,
    downloads,
    /** What the person puts on in the Spotify app: the pane sees it at its next look. */
    play: (next: ReturnType<typeof track>, where = context) => {
      current = next
      context = where
      isPlaying = true
    },
    /** The requests that went to MusicBrainz. */
    musicbrainz: () => calls.filter(c => new URL(c.url).host === 'musicbrainz.org'),
    keychain: () => keychain,
    /** What another session does: it rotates the token and leaves the newest in the Keychain. */
    rotateElsewhere: (newest: string) => {
      if (keychain) revoked.add(keychain)
      keychain = newest
    },
    revoke: (token: string) => revoked.add(token),
    refreshedWith: () =>
      calls.filter(c => c.url === 'https://accounts.spotify.com/api/token').map(c => new URLSearchParams(c.body ?? '').get('refresh_token')),
  }
}

test('the desktop gets the scene, the player and the buttons', CLIENT, async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  engine(on)
  fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svgs = await art(ui)
  // Scene, cover, strip, progress.
  // Scene, cover, strip and progress first; the pixel headings below them.
  expect(svgs.length).toBeGreaterThan(4)
  for (const svg of svgs) {
    const source = String(svg.props.source)
    expect(source.startsWith('<svg')).toBe(true)
    expect(source.length).toBeLessThan(131_072)
    // Each frame gets its size: the desktop would make it 150 px tall.
    expect(typeof svg.props.width).toBe('number')
    expect(typeof svg.props.height).toBe('number')
  }
  // The cover is a still image; the strip beside it animates.
  expect(svgs[1]?.props.isInteractive).toBeUndefined()
  expect(svgs[2]?.props.isInteractive).toBe(true)
  expect(String(svgs[2]?.props.alt)).toContain('Nightcall')
  expect(await ui.find({ key: 'connect' })).toBeDefined()

  // The demo starts paused; play starts the drive.
  expect(String(svgs[0]?.props.source)).not.toContain('<animate attributeName="visibility"')
  await ui.press({ key: 'play' })
  expect(String((await art(ui))[0]?.props.source)).toContain('<animate attributeName="visibility"')

  await ui.press({ key: 'next' })
  expect(String((await art(ui))[2]?.props.alt)).toContain('Odd Look')
  await ui.unmount()
})

test('in a wider pane the art grows in whole retina pixels', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const [columns, width] of [[24, 174], [30, 232], [40, 290], [60, 464]] as const) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: columns } })
    const [scene, cover, strip] = await art(ui)
    expect(scene?.props.width).toBe(width)
    // The cover and the strip together are as wide as the scene.
    expect(Number(cover?.props.width) + Number(strip?.props.width)).toBe(width)
    // Above the scene as much purple as beside it: its frame is taller, the drawing at the bottom.
    expect(scene?.props.height).toBe(Math.round((width * 64) / 116) + Math.min(32, Math.round((columns * 8.8 - width) / 2)))
    expect(String(scene?.props.source)).toContain('xMidYMax')
    await ui.unmount()
  }
})

test('without a Client ID, the demo points the way to a Spotify app of your own', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  const spotify = fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'connect' })).toBeUndefined()
  expect((await ui.find({ type: 'Link', text: /How to make one/ }))?.props.href).toBe('https://github.com/tijshuisman/claude-pixel-tunes#spotify-setup')
  expect((await $.command.run({ command: 'tunes', args: 'login' })).text).toContain('Client ID')
  expect(spotify.calls.some(c => c.url.startsWith('https://accounts.spotify.com'))).toBe(false)
  await ui.unmount()
})

test('in the demo, the next track starts after the last bit of a track', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on)
  fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'play' })
  await clock.advance(258_000 - 97_000 + 500)
  expect(String((await art(ui))[2]?.props.alt)).toContain('Odd Look')
  await ui.unmount()
})

test('a stored login resumes by itself and follows Spotify', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  const spotify = fakeSpotify(on, { keychain: 'refresh-1' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(300)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svgs = await art(ui)
  expect(String(svgs[2]?.props.alt)).toBe('Now playing Nightcall by Kavinsky')
  expect(String(svgs[1]?.props.alt)).toBe('Cover of OutRun')
  expect(String(svgs[1]?.props.source)).toContain('<image href="data:image/jpeg;base64,/9j/')
  expect(String(svgs[0]?.props.source)).toContain('<animate attributeName="visibility"')
  expect(await ui.find({ type: 'Button', text: /Odd Look/ })).toBeDefined()
  expect(await ui.find({ type: 'Link', text: /Open in Spotify/ })).toBeDefined()
  // A refresh hands out a new refresh token; the Keychain keeps the newest.
  expect(spotify.keychain()).toBe('refresh-2')

  await ui.press({ key: 'next' })
  expect(spotify.calls.some(c => c.method === 'POST' && c.url.endsWith('/me/player/next'))).toBe(true)
  await clock.advance(800)
  expect(String((await art(ui))[2]?.props.alt)).toBe('Now playing Tech Noir by Gunship')

  const debug = (await $.command.run({ command: 'tunes', args: 'debug' })).text ?? ''
  expect(debug).toContain('Spotify: connected')
  expect(debug).toContain('Fetching: fetched from i.scdn.co')
  expect(debug).toContain('In the pane: this cover')
  expect(debug).toContain('Genre lookup: off')
  // The model reads this too: the server, but no title, artist, album or image address.
  expect(debug).toContain('Cover server: https://i.scdn.co')
  for (const spotifyData of ['Tech Noir', 'Gunship', 'OutRun', '/image/']) expect(debug).not.toContain(spotifyData)

  await ui.press({ key: 'play' })
  expect(spotify.calls.some(c => c.method === 'PUT' && c.url.endsWith('/me/player/pause'))).toBe(true)
  await ui.unmount()
})

/** Where a progress drawing's clock starts, in seconds: its frame counts on from there by itself. */
const clockStart = (source: string) => Number(/ begin="-([\d.]+)s"/.exec(source)?.[1])

test('after a /clear, Pixel Tunes connects again with the login in the Keychain', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  const spotify = fakeSpotify(on, { keychain: 'refresh-1' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(300)
  const logins = () => spotify.calls.filter(c => c.url === 'https://accounts.spotify.com/api/token').length
  const before = logins()
  expect(before).toBeGreaterThan(0)

  // Another start (a resume) leaves it be; a /clear connects again.
  await $.classic.SessionStart({ source: 'resume' })
  await clock.advance(300)
  expect(logins()).toBe(before)
  await $.classic.SessionStart({ source: 'clear' })
  await clock.advance(300)
  expect(logins()).toBe(before + 1)
  expect((await $.command.run({ command: 'tunes', args: 'debug' })).text).toContain('Spotify: connected')
})

test('the progress shows where the track is now, however long ago Spotify last had news', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  let isTyping = false
  engine(on, { isFocused: () => isTyping })
  // Spotify plays on in step with the clock, so no answer differs from what Pixel Tunes expects.
  const spotify = fakeSpotify(on, { keychain: 'refresh-1', progress: () => 60_000 + clock.now() - 1_000_000 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(30_300)

  // Opened half a minute after the last news, the clock starts at 1:30, not at 1:00.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const progress = async () => String((await art(ui))[3]?.props.source)
  expect(clockStart(await progress())).toBe(90.3)

  // The desktop may load the frame again from its last drawing (after another session was in view),
  // so while music plays each look draws the pane anew: at 2:30 now, it is at most one look behind.
  await clock.advance(60_000)
  expect(clockStart(await progress())).toBeGreaterThanOrEqual(150.3 - 5)

  // While the person types in the pane, it is left alone.
  isTyping = true
  const drawn = clockStart(await progress())
  await clock.advance(30_000)
  expect(clockStart(await progress())).toBe(drawn)
  isTyping = false

  // Opening the pane looks at Spotify right away, not at the next look (a minute on while it was closed).
  const looks = () => spotify.calls.filter(c => c.url.includes('/v1/me/player?')).length
  const before = looks()
  await $.command.run({ command: 'tunes' })
  await clock.advance(300)
  expect(looks()).toBe(before + 1)
  await ui.unmount()
})

test('logging in through the browser connects to Spotify, with PKCE and without a secret', CLIENT, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on)
  const spotify = fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  expect((await $.command.run({ command: 'tunes', args: 'login' })).text).toContain('browser')
  // The login waits 400 ms between starting the listener and opening the browser.
  await clock.advance(100)
  await clock.advance(1_000)
  await clock.advance(1_000)

  const token = spotify.calls.find(c => c.url === 'https://accounts.spotify.com/api/token')
  expect(token?.body).toContain('grant_type=authorization_code')
  expect(token?.body).toContain('code_verifier=')
  expect(token?.body).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A8898%2Fcallback')
  expect(token?.body).not.toContain('client_secret')
  expect(token?.body).toContain('client_id=test-client')
  expect(spotify.keychain()).toBe('refresh-2')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(String((await art(ui))[2]?.props.alt)).toBe('Now playing Nightcall by Kavinsky')
  expect(await ui.find({ key: 'connect' })).toBeUndefined()

  expect((await $.command.run({ command: 'tunes', args: 'logout' })).text).toContain('disconnected')
  expect(spotify.keychain()).toBe(null)
  await ui.unmount()
})

test('without an active device, you choose one', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  engine(on)
  const spotify = fakeSpotify(on, { keychain: 'refresh-1', noDevice: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(300)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'play' })
  expect(await ui.find({ type: 'Text', text: /Choose where Pixel Tunes plays/ })).toBeDefined()
  expect(await ui.find({ key: 'device-phone' })).toBeDefined()

  await ui.press({ key: 'device-mac' })
  const moved = spotify.calls.find(c => c.method === 'PUT' && c.url.endsWith('/v1/me/player'))
  expect(moved?.body).toBe('{"device_ids":["mac"],"play":true}')
  expect(await ui.find({ key: 'device-phone' })).toBeUndefined()
  await ui.unmount()
})

test('the command controls the demo', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect((await $.command.run({ command: 'tunes', args: 'next' })).text).toContain('Odd Look')
  expect((await $.command.run({ command: 'tunes', args: 'pause' })).text).toContain('paused')
  expect((await $.command.run({ command: 'tunes', args: '' })).text).toContain('next to the chat')
})

test('while the pane is closed, a button above the prompt opens it', async ($, on) => {
  mock.clock(on, { now: 0 })
  const { opened } = engine(on, { isOpen: false })
  emptyBand(on)
  fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'open' })
  expect(opened).toEqual(['pixel-tunes'])
  // With the pane open, the button is gone.
  expect(await band.find({ key: 'open' })).toBeUndefined()
  await band.unmount()
})

test('the band stays as it was in the terminal, and while a survey holds it', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on, { isOpen: false })
  emptyBand(on)
  fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await terminal.find({ key: 'open' })).toBeUndefined()
  await terminal.unmount()

  const survey = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } })
  expect(await survey.find({ key: 'open' })).toBeUndefined()
  await survey.unmount()
})

test('the terminal gets the scene in half blocks and a player of text', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const raster = await ui.find({ type: 'Raster' })
  // As wide as the pane, the middle of the scene: two art pixels to a cell, down.
  expect(raster?.props.columns).toBe(30)
  expect(raster?.props.rows).toBe(32)
  expect(String(raster?.props.cells).length).toBe(Math.ceil((30 * 32 * 12) / 3) * 4)
  expect(await ui.find({ type: 'Text', text: /^Nightcall$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Kavinsky$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1:37 ━+─+ 4:18$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /UP NEXT/ })).toBeDefined()
  // Purple to the bottom of the pane.
  expect((await ui.find({ type: 'Box' }))?.props.minHeight).toBe(40)

  // The controls answer the same presses as on the desktop.
  await ui.press({ key: 'next' })
  expect(await ui.find({ type: 'Text', text: /^Odd Look$/ })).toBeDefined()
  await ui.unmount()
})

test('a terminal that draws pictures gets the scene as a sharp picture as wide as the pane', { options: { terminal_images: true } }, async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 80 } })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  const image = await ui.find({ type: 'Image' })
  // As wide as the pane, a row for every 3.6 columns.
  expect(image?.props.columns).toBe(78)
  expect(image?.props.rows).toBe(22)
  // A PNG of the mod's own, small enough to send several times a second.
  const source = String((image?.props.source as { png?: string } | undefined)?.png)
  expect(source.startsWith('iVBORw0KGgo')).toBe(true)
  expect(source.length).toBeLessThan(150_000)
  expect(await ui.find({ key: 'play' })).toBeDefined()
  await ui.unmount()
})

test('every scene turns into pixels of its own for the terminal', () => {
  for (const id of THEME_IDS) {
    const px = scenePixels(id)
    expect(px.length).toBe(116 * 64)
    // A drawing, not a blank: many colours, the scene's own.
    expect(new Set(px).size).toBeGreaterThan(8)
  }
  expect(new Set(THEME_IDS.map(id => scenePixels(id).join(','))).size).toBe(THEME_IDS.length)
  // A pane wider than the scene gets all of it.
  expect(sceneCells('nightdrive', 200).columns).toBe(116)
})

for (const [image, isFetched] of [
  ['https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02ff9ca10b55ce82ae553c8228', true],
  ['https://mosaic.scdn.co/300/ab67616d0000b273', true],
  ['http://i.scdn.co/image/ab67616d00001e02', false],
  ['https://i.scdn.co.evil.example/image/x', false],
] as const)
  test(`a cover from ${new URL(image).origin} is ${isFetched ? '' : 'not '}fetched`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    engine(on)
    const spotify = fakeSpotify(on, { keychain: 'refresh-1', image })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await clock.advance(300)

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const cover = String((await art(ui))[1]?.props.source)
    expect(cover.includes('<image href="data:image/jpeg;base64,/9j/')).toBe(isFetched)
    // The shell only ever sees an allowed address, as an argument.
    expect(spotify.downloads).toEqual(isFetched ? [image] : [])
    if (!isFetched) {
      const debug = (await $.command.run({ command: 'tunes', args: 'debug' })).text ?? ''
      expect(debug).toContain(`skipped, not a Spotify image server: ${new URL(image).origin}`)
      expect(debug).not.toContain('/image/')
    }
    await ui.unmount()
  })

/** A connected session with the pane mounted on the desktop. */
async function connectedPane(
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: On,
  start: Parameters<typeof fakeSpotify>[1] = {},
  store: Record<string, unknown> = {},
) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const { tools, opened } = engine(on, { store })
  const spotify = fakeSpotify(on, { keychain: 'refresh-1', ...start })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(300)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const played = () => spotify.calls.filter(c => c.method === 'PUT' && c.url.endsWith('/v1/me/player/play')).map(c => c.body)
  /** What the scene shows, by its alt: "Pixel-art campfire: …". */
  const shows = async () => String((await art(ui))[0]?.props.alt)
  /** The theme button's label. */
  const themeButton = async () => (await ui.find({ key: 'theme' }))?.text
  return { clock, spotify, ui, played, tools, opened, shows, themeButton }
}

test('search finds tracks, albums, playlists and artists, and plays them', async ($, on) => {
  const { spotify, ui, played } = await connectedPane($, on)

  await ui.press({ key: 'tab-search' })
  await ui.input({ key: 'search', text: '   ' })
  expect(await ui.find({ type: 'Text', text: /Type what you are looking for/ })).toBeDefined()

  await ui.input({ key: 'search', text: 'nightcall' })
  const asked = spotify.calls.find(c => c.url.includes('/v1/search?'))
  expect(asked?.url).toContain('q=nightcall')
  expect(asked?.url).toContain('type=track%2Calbum%2Cplaylist%2Cartist')
  for (const group of ['Tracks', 'Albums', 'Playlists', 'Artists']) expect(await ui.find({ type: 'Text', text: group })).toBeDefined()

  // A track plays within its album, so the album goes on after it.
  await ui.press({ key: 'play-s-track-0' })
  expect(played().at(-1)).toBe('{"context_uri":"spotify:album:outrun","offset":{"uri":"spotify:track:nc1"}}')
  await ui.press({ key: 'play-s-playlist-0' })
  expect(played().at(-1)).toBe('{"context_uri":"spotify:playlist:drive"}')
  await ui.press({ key: 'play-s-artist-0' })
  expect(played().at(-1)).toBe('{"context_uri":"spotify:artist:kavinsky"}')

  await ui.press({ key: 'queue-s-track-0' })
  expect(spotify.calls.some(c => c.method === 'POST' && c.url.endsWith('/v1/me/player/queue?uri=spotify%3Atrack%3Anc1'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /Queued: Nightcall/ })).toBeDefined()
  await ui.unmount()
})

test('your playlists, loading more, and playing one', async ($, on) => {
  const { ui, played } = await connectedPane($, on)

  await ui.press({ key: 'tab-playlists' })
  expect((await ui.find({ key: 'play-pl-0' }))?.text).toContain('Coding at 3am')
  expect(await ui.find({ type: 'Text', text: /7 tracks/ })).toBeDefined()
  await ui.press({ key: 'more-playlists' })
  expect((await ui.find({ key: 'play-pl-2' }))?.text).toContain('Retro')
  expect(await ui.find({ key: 'more-playlists' })).toBeUndefined()

  await ui.press({ key: 'play-pl-1' })
  expect(played().at(-1)).toBe('{"context_uri":"spotify:playlist:b"}')
  await ui.unmount()
})

test('recently played, each track once, in its own context', async ($, on) => {
  const { ui, played } = await connectedPane($, on)

  await ui.press({ key: 'tab-recent' })
  expect((await ui.find({ key: 'play-r-0' }))?.text).toContain('Turbo Killer')
  expect((await ui.find({ key: 'play-r-1' }))?.text).toContain('Resonance')
  expect(await ui.find({ key: 'play-r-3' })).toBeUndefined()

  // A long line is cut to the pane's width, so its + stays in view.
  expect((await ui.find({ key: 'play-r-2' }))?.text).toBe('Zenith')
  const long = (await ui.find({ type: 'Text', text: /^Kavinsky, Olivia/ }))?.text ?? ''
  expect(long.startsWith('Kavinsky, Olivia')).toBe(true)
  expect(long.endsWith('…')).toBe(true)
  expect([...long].length).toBeLessThanOrEqual(30)
  expect(await ui.find({ key: 'queue-r-2' })).toBeDefined()

  await ui.press({ key: 'play-r-0' })
  expect(played().at(-1)).toBe('{"context_uri":"spotify:playlist:a","offset":{"uri":"spotify:track:t1"}}')
  await ui.press({ key: 'play-r-1' })
  expect(played().at(-1)).toBe('{"context_uri":"spotify:album:odyssey","offset":{"uri":"spotify:track:t2"}}')

  // Back to the queue tab: the list of what plays next.
  await ui.press({ key: 'tab-queue' })
  expect(await ui.find({ type: 'Button', text: /Odd Look/ })).toBeDefined()
  await ui.unmount()
})

test('when another session refreshes the token, this one takes the newest from the Keychain', async ($, on) => {
  const { clock, spotify, ui } = await connectedPane($, on)
  expect(spotify.refreshedWith()).toEqual(['refresh-1'])

  // Meanwhile another session refreshed: refresh-2 is spent, the Keychain holds its successor.
  spotify.rotateElsewhere('refresh-elsewhere')
  await clock.advance(3_600_000)

  expect(spotify.refreshedWith()).toEqual(['refresh-1', 'refresh-elsewhere'])
  expect(spotify.keychain()).toBe('refresh-3')
  expect(await ui.find({ key: 'connect' })).toBeUndefined()
  await ui.unmount()
})

test('a revoked token asks to connect again, but leaves the Keychain alone', async ($, on) => {
  const { clock, spotify, ui } = await connectedPane($, on)
  spotify.revoke('refresh-2')
  await clock.advance(3_600_000)

  expect(await ui.find({ type: 'Text', text: /was revoked/ })).toBeDefined()
  expect(await ui.find({ key: 'connect' })).toBeDefined()
  // Another session may still hold a newer token there: only /tunes logout deletes it.
  expect(spotify.keychain()).toBe('refresh-2')
  await ui.unmount()
})

test('Claude puts music on with play_music, and the model only hears that it worked', async ($, on) => {
  spinnerLine(on)
  const { clock, spotify, ui, played, tools } = await connectedPane($, on, { isPlaying: false })

  // The tool is in the prompt from the first turn, not behind tool search.
  const tool = tools.find(t => t.name === 'play_music')
  expect(tool?.isDeferred).toBe(false)
  expect(tool?.inputSchema['required']).toEqual(['query'])

  const spinner = await $.ui.mount({ ...SPINNER, surface: 'desktop' })
  expect((await spinner.find({ type: 'Text' }))?.text).toBe('Thinking…')

  const answer = await $.tool.call({ tool: PLAY_MUSIC, query: 'Nightcall Kavinsky' })
  // Spotify's terms: no title, artist, album or address goes to the model.
  expect(answer).toEqual({ result: 'Playback started.' })
  expect(spotify.calls.find(c => c.url.includes('/v1/search?'))?.url).toContain('q=Nightcall+Kavinsky')
  // The best match is the track, and it plays within its album.
  expect(played()).toEqual(['{"context_uri":"spotify:album:outrun","offset":{"uri":"spotify:track:nc1"}}'])

  // What plays, the person sees: in the spinner and in the pane.
  await clock.advance(800)
  expect((await spinner.find({ type: 'Text' }))?.text).toBe('Thinking · ♪ Nightcall – Kavinsky…')
  expect(String((await art(ui))[0]?.props.source)).toContain('<animate attributeName="visibility"')
  await spinner.unmount()
  await ui.unmount()
})

test('play_music without a Spotify connection says so and opens the pane to connect', CLIENT, async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { opened } = engine(on)
  const spotify = fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()

  const answer = await $.tool.call({ tool: PLAY_MUSIC, query: 'Nightcall Kavinsky' })
  expect(answer).toEqual({ result: 'Not connected to Spotify: the user connects in the Pixel Tunes pane.' })
  expect(opened).toEqual(['pixel-tunes'])
  expect(spotify.calls).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'connect' })).toBeDefined()
  await ui.unmount()
})

test('play_music without an active device lets the pane choose one', async ($, on) => {
  const { spotify, ui, opened } = await connectedPane($, on, { noDevice: true })

  const answer = await $.tool.call({ tool: PLAY_MUSIC, query: 'Nightcall Kavinsky' })
  expect(answer).toEqual({ result: 'No Spotify device active: the user picks or opens one in the Pixel Tunes pane.' })
  expect(opened).toEqual(['pixel-tunes'])
  expect(await ui.find({ type: 'Text', text: /Choose where Pixel Tunes plays/ })).toBeDefined()
  // Two devices: the choice is the person's, so nothing played on either.
  expect(spotify.calls.some(c => c.url.includes('device_id='))).toBe(false)

  // The choice plays what was asked for there, not what the phone played last.
  await ui.press({ key: 'device-phone' })
  const played = spotify.calls.filter(c => c.method === 'PUT' && c.url.includes('/v1/me/player/play?device_id=phone'))
  expect(played).toHaveLength(1)
  expect(played[0]?.body).toContain('spotify:track:nc1')
  expect(spotify.calls.some(c => c.method === 'PUT' && c.url.endsWith('/v1/me/player'))).toBe(false)
  await ui.unmount()
})

test('closing the device picker forgets what was asked for', async ($, on) => {
  const { spotify, ui } = await connectedPane($, on, { noDevice: true })

  await $.tool.call({ tool: PLAY_MUSIC, query: 'Nightcall Kavinsky' })
  // Closed and opened again by hand: a choice then moves the music, as it always did.
  await ui.press({ key: 'device' })
  await ui.press({ key: 'device' })
  await ui.press({ key: 'device-phone' })
  expect(spotify.calls.find(c => c.method === 'PUT' && c.url.endsWith('/v1/me/player'))?.body).toBe('{"device_ids":["phone"],"play":true}')
  expect(spotify.calls.some(c => c.url.includes('device_id=phone'))).toBe(false)
  await ui.unmount()
})

test('play_music without an active device plays on the only device there is', async ($, on) => {
  const { spotify, ui } = await connectedPane($, on, { noDevice: true, soleDevice: true })

  const answer = await $.tool.call({ tool: PLAY_MUSIC, query: 'Nightcall Kavinsky', kind: 'track' })
  expect(answer).toEqual({ result: 'Playback started.' })
  const plays = spotify.calls.filter(c => c.method === 'PUT' && c.url.includes('/v1/me/player/play'))
  expect(plays.map(c => c.url.replace('https://api.spotify.com/v1', ''))).toEqual(['/me/player/play', '/me/player/play?device_id=mac'])
  expect(plays[1]?.body).toBe('{"context_uri":"spotify:album:outrun","offset":{"uri":"spotify:track:nc1"}}')
  // The device wakes with this music, not with what it played last, and no picker opens.
  expect(spotify.calls.some(c => c.method === 'PUT' && c.url.endsWith('/v1/me/player'))).toBe(false)
  expect(await ui.find({ key: 'device-mac' })).toBeUndefined()
  await ui.unmount()
})

test('play_music plays the kind asked for, and says so when there is nothing to find or to search for', async ($, on) => {
  const { ui, played } = await connectedPane($, on)
  const play = async (args: { query: string; kind?: string }) => (await $.tool.call({ tool: PLAY_MUSIC, ...args })).result

  expect(await play({ query: 'night drive', kind: 'playlist' })).toBe('Playback started.')
  expect(await play({ query: 'outrun', kind: 'album' })).toBe('Playback started.')
  expect(await play({ query: 'kavinsky', kind: 'artist' })).toBe('Playback started.')
  expect(played()).toEqual(['{"context_uri":"spotify:playlist:drive"}', '{"context_uri":"spotify:album:outrun"}', '{"context_uri":"spotify:artist:kavinsky"}'])

  expect(await play({ query: 'nothing' })).toBe('Nothing found on Spotify.')
  expect(await play({ query: '   ' })).toBe('Give a search term.')
  expect(played()).toHaveLength(3)
  await ui.unmount()
})

test('a session that takes no tools from plugins keeps the player', CLIENT, async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on, { takesTools: false })
  fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(String((await art(ui))[2]?.props.alt)).toContain('Nightcall')
  expect(await ui.find({ key: 'connect' })).toBeDefined()
  await ui.unmount()
})

test('after a revoked token, /tunes next names no Spotify tracks', async ($, on) => {
  const { clock, spotify, ui } = await connectedPane($, on)
  spotify.revoke('refresh-2')
  await clock.advance(3_600_000)
  expect(await ui.find({ key: 'connect' })).toBeDefined()

  // The pane still holds Spotify's queue; the command's text, which the model reads, names none of it.
  expect((await $.command.run({ command: 'tunes', args: 'next' })).text).toBe('♪ Track changed.')
  await ui.unmount()
})

test('search results become things to play', async () => {
  const items = toSearchItems({
    tracks: { items: [null, { id: 'x', uri: 'spotify:track:x', name: 'Tech Noir', duration_ms: 1, artists: [{ name: 'Gunship' }] }] },
    playlists: { items: [{ uri: 'spotify:playlist:p', name: 'P', tracks: { total: 3 } }, null] },
    // Spotify often sends no genres any more: then no subtitle, not a filler word.
    artists: { items: [{ uri: 'spotify:artist:g', name: 'Gunship' }] },
  })
  expect(items).toEqual([
    { kind: 'track', uri: 'spotify:track:x', title: 'Tech Noir', subtitle: 'Gunship' },
    { kind: 'playlist', uri: 'spotify:playlist:p', title: 'P', subtitle: '3 tracks' },
    { kind: 'artist', uri: 'spotify:artist:g', title: 'Gunship', subtitle: '' },
  ])
  expect(toSearchItems(null)).toEqual([])
})

test('Spotify status becomes our playback state', async () => {
  const before = { track: null, isPlaying: false, positionMs: 0, at: 0, shuffle: false, repeat: 'off', volume: 50, device: '' } as const
  const raw = {
    device: { name: 'Kitchen', volume_percent: 30 },
    shuffle_state: true,
    repeat_state: 'track',
    progress_ms: 1234,
    is_playing: true,
    item: { ...track('abc', 'Résonance', 'Home'), album: { name: 'Odyssey', images: [{ url: 'https://i.scdn.co/image/big', width: 640 }, { url: 'https://i.scdn.co/image/mid', width: 300 }, { url: 'https://i.scdn.co/image/small', width: 64 }] } },
    context: null,
  }
  const p = toPlayback(raw, 42, before)
  expect(p.track?.title).toBe('Résonance')
  expect(p.track?.imageUrl).toBe('https://i.scdn.co/image/mid')
  expect(p.repeat).toBe('track')
  expect(p.volume).toBe(30)
  expect(p.device).toBe('Kitchen')
  expect(p.at).toBe(42)
  expect(p.context).toBeUndefined()
  expect(toPlayback(null, 7, before).track).toBe(null)
})

/* ── the scene's theme ────────────────────────────────────────────────── */

const MUSICBRAINZ: MusicBrainz = {
  recordings: { USUM71900001: { id: '7b2c1e6a-0e8f-4d1c-9a51-2f3e8c0d4b11', name: 'Big Thief' } },
  genres: { '7b2c1e6a-0e8f-4d1c-9a51-2f3e8c0d4b11': [{ name: 'indie folk', count: 6 }, { name: 'indie rock', count: 4 }] },
}

test('a remembered artist picks the scene, also as a guest, and every family has a scene of its own', async ($, on) => {
  const { clock, spotify, ui, shows, themeButton } = await connectedPane($, on, { current: song('ff', 'Mykonos', ['Fleet Foxes']) })
  // There is no list to start from: an artist nobody chose a scene for gets the night drive.
  expect(await shows()).toContain('Pixel-art night drive')
  expect(await themeButton()).toBe('Night Drive ▾')
  await ui.press({ key: 'theme' })
  await ui.press({ key: 'theme-campfire' })
  await ui.press({ key: 'remember-artist' })
  expect(await themeButton()).toBe('Campfire ▾')

  // A guest counts too: the first artist on the list chooses.
  spotify.play(song('ft', 'Together', ['Someone Unknown', 'Fleet Foxes']))
  await clock.advance(5_000)
  expect(await shows()).toContain('Pixel-art campfire')
  await ui.press({ key: 'theme' })
  expect(await ui.find({ type: 'Text', text: 'Automatic: by artist (Fleet Foxes).' })).toBeDefined()

  // Every family has a scene of its own.
  for (const id of THEME_IDS) {
    await ui.press({ key: `theme-${id}` })
    expect(await shows()).toContain(`Pixel-art ${THEMES[id].name.toLowerCase()}`)
  }
  await ui.unmount()
})

test('a manual pick wins, and remembering it for the artist makes it the rule', async ($, on) => {
  const { clock, spotify, ui, shows, themeButton } = await connectedPane($, on, { current: song('nd', 'Pink Moon', ['Nick Drake']) })
  await ui.press({ key: 'theme' })
  expect((await ui.find({ key: 'theme-auto' }))?.text).toBe('● Automatic (Night Drive)')
  await ui.press({ key: 'theme-citylights' })
  expect(await shows()).toContain('Pixel-art city lights')
  expect((await ui.find({ key: 'theme-citylights' }))?.text).toBe('● City Lights')

  // The pick holds for the next track too, until Automatic.
  spotify.play(song('nd2', 'Northern Sky', ['Nick Drake']))
  await clock.advance(5_000)
  expect(await shows()).toContain('Pixel-art city lights')
  await ui.press({ key: 'theme-auto' })
  expect(await shows()).toContain('Pixel-art night drive')

  // Kept for the artist, the pick is what Automatic chooses from now on.
  await ui.press({ key: 'theme-campfire' })
  await ui.press({ key: 'remember-artist' })
  expect(await ui.find({ key: 'theme-auto' })).toBeUndefined()
  expect(await themeButton()).toBe('Campfire ▾')
  await ui.press({ key: 'theme' })
  expect((await ui.find({ key: 'theme-auto' }))?.text).toBe('● Automatic (Campfire)')
  spotify.play(song('nd3', 'River Man', ['Nick Drake']))
  await clock.advance(5_000)
  expect(await shows()).toContain('Pixel-art campfire')
  await ui.unmount()
})

test('a playlist with folk in its name gets Campfire', async ($, on) => {
  const { ui, shows, spotify } = await connectedPane($, on, {
    current: song('bt', 'Not', ['Big Thief']),
    context: 'spotify:playlist:folk123',
    playlists: { folk123: 'Indie Folk Evenings' },
  })
  expect(spotify.calls.some(c => c.url.endsWith('/v1/playlists/folk123?fields=name'))).toBe(true)
  expect(await shows()).toContain('Pixel-art campfire')
  await ui.press({ key: 'theme' })
  expect(await ui.find({ type: 'Text', text: 'Automatic: by playlist name (Indie Folk Evenings).' })).toBeDefined()
  await ui.unmount()
})

test('a remembered playlist wins over the artist, and can be forgotten again', async ($, on) => {
  const { ui, shows } = await connectedPane($, on, {
    current: song('ip', 'Evil', ['Interpol']),
    context: 'spotify:playlist:folk123',
    playlists: { folk123: 'Indie Folk Evenings' },
  })
  expect(await shows()).toContain('Pixel-art campfire')
  // A remembered artist goes before the playlist's name.
  await ui.press({ key: 'theme' })
  await ui.press({ key: 'theme-citylights' })
  await ui.press({ key: 'remember-artist' })
  expect(await shows()).toContain('Pixel-art city lights')

  await ui.press({ key: 'theme' })
  await ui.press({ key: 'theme-campfire' })
  await ui.press({ key: 'remember-playlist' })
  expect(await shows()).toContain('Pixel-art campfire')
  await ui.press({ key: 'theme' })
  expect(await ui.find({ type: 'Text', text: 'Automatic: remembered for this playlist.' })).toBeDefined()

  await ui.press({ key: 'forget-playlist' })
  expect(await shows()).toContain('Pixel-art city lights')
  await ui.unmount()
})

test('without opt-in, no request goes to musicbrainz.org', async ($, on) => {
  const { clock, spotify, ui, shows } = await connectedPane($, on, { current: song('bt', 'Not', ['Big Thief'], 'USUM71900001'), musicbrainz: MUSICBRAINZ })
  await clock.advance(10_000)
  expect(await shows()).toContain('Pixel-art night drive')
  expect(spotify.musicbrainz()).toEqual([])
  await ui.unmount()
})

test('with opt-in, Pixel Tunes looks up the genre by the ISRC, once per artist', { options: { genre_lookup: true } }, async ($, on) => {
  const { clock, spotify, ui, shows } = await connectedPane($, on, { current: song('bt', 'Not', ['Big Thief'], 'USUM71900001'), musicbrainz: MUSICBRAINZ })
  // MusicBrainz is asked at most once a second.
  expect(spotify.musicbrainz()).toHaveLength(1)
  await clock.advance(1_200)
  const asked = spotify.musicbrainz()
  expect(asked.map(c => new URL(c.url).pathname)).toEqual(['/ws/2/isrc/USUM71900001', '/ws/2/artist/7b2c1e6a-0e8f-4d1c-9a51-2f3e8c0d4b11'])
  // By the ISRC, never the name; and Pixel Tunes names itself.
  expect(asked.some(c => c.url.includes('Thief'))).toBe(false)
  expect(asked[0]?.headers?.['User-Agent']).toContain('PixelTunes/')
  expect(await shows()).toContain('Pixel-art campfire')
  await ui.press({ key: 'theme' })
  expect(await ui.find({ type: 'Text', text: 'Automatic: by the genre of Big Thief (MusicBrainz).' })).toBeDefined()
  expect((await $.command.run({ command: 'tunes', args: 'debug' })).text).toContain(
    "Genre lookup: on · last lookup: Campfire, by the artist's genres on MusicBrainz",
  )

  // The next song of that artist needs no new question.
  spotify.play(song('bt2', 'Simulation Swarm', ['Big Thief'], 'USUM72200002'))
  await clock.advance(5_000)
  expect(spotify.musicbrainz()).toHaveLength(2)
  expect(await shows()).toContain('Pixel-art campfire')
  await ui.unmount()
})

test('without an ISRC, MusicBrainz finds the artist by its Spotify page', { options: { genre_lookup: true } }, async ($, on) => {
  const bigThief = { id: '7b2c1e6a-0e8f-4d1c-9a51-2f3e8c0d4b11', name: 'Big Thief' }
  const page = 'https://open.spotify.com/artist/BigThief00000000000000'
  // What Spotify gives a development app: the artist's ID, but no ISRC.
  const current = { ...song('bt', 'Not', ['Big Thief']), artists: [{ name: 'Big Thief', id: 'BigThief00000000000000' }] }
  const { clock, spotify, ui, shows } = await connectedPane($, on, { current, musicbrainz: { ...MUSICBRAINZ, spotifyPages: { [page]: bigThief } } })
  await clock.advance(5_000)
  expect(await shows()).toContain('Pixel-art campfire')
  const asked = spotify.musicbrainz().map(c => new URL(c.url))
  expect(asked.map(u => u.pathname)).toEqual(['/ws/2/url', `/ws/2/artist/${bigThief.id}`])
  expect(asked[0]?.searchParams.get('resource')).toBe(page)
  // The model reads /tunes debug: never the artist's ID.
  const said = (await $.command.run({ command: 'tunes', args: 'debug' })).text ?? ''
  expect(said).toContain("last lookup: Campfire, by the artist's genres on MusicBrainz")
  expect(said).not.toContain('BigThief0')
  await ui.unmount()
})

test('a recording MusicBrainz does not know leaves its artist open for the next track', { options: { genre_lookup: true } }, async ($, on) => {
  const { clock, spotify, ui, shows } = await connectedPane($, on, { current: song('bt0', 'Masterpiece', ['Big Thief'], 'USUM71600009'), musicbrainz: MUSICBRAINZ })
  const debug = async () => (await $.command.run({ command: 'tunes', args: 'debug' })).text ?? ''
  await clock.advance(5_000)
  expect(await shows()).toContain('Pixel-art night drive')
  expect(await debug()).toContain("Genre lookup: on · last lookup: MusicBrainz knows neither the artist's Spotify page nor the recording")

  // MusicBrainz knows the artist's next track: now its genres choose.
  spotify.play(song('bt', 'Not', ['Big Thief'], 'USUM71900001'))
  await clock.advance(10_000)
  expect(await shows()).toContain('Pixel-art campfire')
  // The model reads /tunes debug: never the artist or the ISRC.
  const said = await debug()
  expect(said).toContain("last lookup: Campfire, by the artist's genres on MusicBrainz")
  for (const spotifyData of ['Big Thief', 'USUM']) expect(said).not.toContain(spotifyData)
  await ui.unmount()
})

test("when musicbrainz.org cannot be reached, the artist's next track asks again", { options: { genre_lookup: true } }, async ($, on) => {
  const bigThief = { id: '7b2c1e6a-0e8f-4d1c-9a51-2f3e8c0d4b11', name: 'Big Thief' }
  const musicbrainz = { ...MUSICBRAINZ, recordings: { USUM71900001: bigThief, USUM72200002: bigThief }, isDown: true }
  const { clock, spotify, ui, shows } = await connectedPane($, on, { current: song('bt', 'Not', ['Big Thief'], 'USUM71900001'), musicbrainz })
  await clock.advance(5_000)
  expect(await shows()).toContain('Pixel-art night drive')
  // What went wrong, without the address that holds the ISRC.
  const said = (await $.command.run({ command: 'tunes', args: 'debug' })).text ?? ''
  expect(said).toContain('Genre lookup: on · last lookup failed: musicbrainz.org cannot be reached')
  expect(said).not.toContain('USUM')

  musicbrainz.isDown = false
  spotify.play(song('bt2', 'Simulation Swarm', ['Big Thief'], 'USUM72200002'))
  await clock.advance(10_000)
  expect(await shows()).toContain('Pixel-art campfire')
  await ui.unmount()
})

test('words in the playlist name and genres choose a family', () => {
  expect(themeOfName('Indie Folk Evenings')).toBe('campfire')
  expect(themeOfName('Late Night Synthwave')).toBe('nightdrive')
  expect(themeOfName('Lo-fi for coding')).toBe('dreampop')
  expect(themeOfName('Coding at 3am')).toBe(null)
  // Folk before psych, but freak folk stays psychedelic; the most voted genres count.
  expect(themeOfGenres([{ name: 'indie rock', count: 5 }, { name: 'indie folk', count: 4 }])).toBe('campfire')
  expect(themeOfGenres([{ name: 'freak folk', count: 5 }, { name: 'psychedelic pop', count: 3 }])).toBe('psychedelic')
  expect(themeOfGenres([{ name: 'synthwave', count: 9 }, { name: 'electro house', count: 6 }])).toBe('nightdrive')
  expect(themeOfGenres([{ name: 'jazz', count: 9 }])).toBe(null)
})

test('every scene fits in an Svg and moves only while playing', () => {
  for (const id of THEME_IDS) for (const isPlaying of [true, false]) expect(scene(id, isPlaying).length).toBeLessThan(131_072)
  // Each family draws its own scene, and says what it shows.
  expect(new Set(THEME_IDS.map(id => scene(id, true))).size).toBe(THEME_IDS.length)
  for (const id of THEME_IDS) expect(THEMES[id].alt.startsWith(`Pixel-art ${THEMES[id].name.toLowerCase()}: `)).toBe(true)
  // Paused, only the stars twinkle: two groups of them by the campfire, over the desert and over the lake; none in town or in the club.
  for (const id of ['campfire', 'psychedelic', 'dreampop'] as const) expect(scene(id, false).match(/<animate/g)).toHaveLength(2)
  for (const id of ['citylights', 'dancefloor'] as const) expect(scene(id, false)).not.toContain('<animate')
  // Playing, the snow and the rain fall, the ball's specks and the aurora drift, and the desert's colours flow.
  for (const id of ['campfire', 'citylights', 'dancefloor', 'dreampop'] as const) expect(scene(id, true)).toContain('<animateTransform')
  expect(scene('psychedelic', true)).toContain('<animate attributeName="fill"')
})

test('with nothing playing, the strip says so', () => {
  const idle = { track: null, isPlaying: false, positionMs: 0, at: 0, shuffle: false, repeat: 'off', volume: 50, device: '' } as const
  // In pixel text, where the title and the artist go.
  const drawn = strip(idle, false)
  expect(drawn).toContain(glyphs('Nothing', 2, 9, 2))
  expect(drawn).toContain(glyphs('playing', 2, 29, 2))
})
