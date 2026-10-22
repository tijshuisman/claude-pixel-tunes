import { expect, mock, test } from 'claude-code/testing'
import type { On, RegisteredToolSpec } from 'claude-code'

import { themeOfGenres, themeOfName } from '../hooks/genre'
import { scene } from '../hooks/render'
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

const PLAY_MUSIC = 'mcp__pixel-tunes__play_music'

// A Spotify Client ID, as the person sets it; without one there is only the demo.
const CLIENT = { options: { spotify_client_id: 'test-client' } }

// Nothing sits beneath the plugin: these hooks stand for the engine.
function engine(on: On, { takesTools = true, store = {} }: { takesTools?: boolean; store?: Record<string, unknown> } = {}) {
  const tools: RegisteredToolSpec[] = []
  const opened: string[] = []
  mock.store(on, store)
  on('command.register', () => ({ value: { command: 'tunes' } }))
  on('tool.register', (_, e) => {
    if (!takesTools) return { deny: 'this session takes no tools from plugins' }
    tools.push(e)
    return { value: { tool: `mcp__pixel-tunes__${e.name}` } }
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [{ id: 'pixel-tunes', title: 'Pixel Tunes' }] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return { tools, opened }
}

/** The engine's own spinner line beneath the plugin: its word, then what follows. */
function spinnerLine(on: On): void {
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`${e.props.word}${e.props.suffix}`}</Text>
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
      const [, , , kind, id] = url.pathname.split('/')
      const artist = kind === 'isrc' ? start.musicbrainz?.recordings[id ?? ''] : undefined
      if (artist) return answer(200, { isrc: id, recordings: [{ id: 'rec', 'artist-credit': [{ name: artist.name, artist }] }] })
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
              progress_ms: 60_000,
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
  const svgs = await ui.findAll({ type: 'Svg' })
  // Scene, cover, strip, progress.
  expect(svgs).toHaveLength(4)
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
  expect(String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)).toContain('<animate attributeName="visibility"')

  await ui.press({ key: 'next' })
  expect(String((await ui.findAll({ type: 'Svg' }))[2]?.props.alt)).toContain('Odd Look')
  await ui.unmount()
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
  expect(String((await ui.findAll({ type: 'Svg' }))[2]?.props.alt)).toContain('Odd Look')
  await ui.unmount()
})

test('a stored login resumes by itself and follows Spotify', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  engine(on)
  const spotify = fakeSpotify(on, { keychain: 'refresh-1' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(300)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svgs = await ui.findAll({ type: 'Svg' })
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
  expect(String((await ui.findAll({ type: 'Svg' }))[2]?.props.alt)).toBe('Now playing Tech Noir by Gunship')

  const debug = (await $.command.run({ command: 'tunes', args: 'debug' })).text ?? ''
  expect(debug).toContain('Spotify: connected')
  expect(debug).toContain('Fetching: fetched from i.scdn.co')
  expect(debug).toContain('In the pane: this cover')
  // The model reads this too: the server, but no title, artist, album or image address.
  expect(debug).toContain('Cover server: https://i.scdn.co')
  for (const spotifyData of ['Tech Noir', 'Gunship', 'OutRun', '/image/']) expect(debug).not.toContain(spotifyData)

  await ui.press({ key: 'play' })
  expect(spotify.calls.some(c => c.method === 'PUT' && c.url.endsWith('/me/player/pause'))).toBe(true)
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
  expect(String((await ui.findAll({ type: 'Svg' }))[2]?.props.alt)).toBe('Now playing Nightcall by Kavinsky')
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

test('the terminal gets a text version', async ($, on) => {
  mock.clock(on, { now: 0 })
  engine(on)
  fakeSpotify(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Nightcall – Kavinsky/ })).toBeDefined()
  await ui.unmount()
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
    const cover = String((await ui.findAll({ type: 'Svg' }))[1]?.props.source)
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
  const shows = async () => String((await ui.findAll({ type: 'Svg' }))[0]?.props.alt)
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
  expect((await ui.find({ key: 'play-pl-1' }))?.text).toContain('7 tracks')
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
  const long = (await ui.find({ key: 'play-r-2' }))?.text ?? ''
  expect(long.startsWith('Zenith Kavinsky')).toBe(true)
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
  expect(String((await ui.findAll({ type: 'Svg' }))[0]?.props.source)).toContain('<animate attributeName="visibility"')
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

  await ui.press({ key: 'device-phone' })
  expect(spotify.calls.find(c => c.method === 'PUT' && c.url.endsWith('/v1/me/player'))?.body).toBe('{"device_ids":["phone"],"play":true}')
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
  expect(String((await ui.findAll({ type: 'Svg' }))[2]?.props.alt)).toContain('Nightcall')
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
  expect(await themeButton()).toBe('Scene: Night Drive ▾')
  await ui.press({ key: 'theme' })
  await ui.press({ key: 'theme-campfire' })
  await ui.press({ key: 'remember-artist' })
  expect(await themeButton()).toBe('Scene: Campfire ▾')

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
  expect(await themeButton()).toBe('Scene: Campfire ▾')
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

  // The next song of that artist needs no new question.
  spotify.play(song('bt2', 'Simulation Swarm', ['Big Thief'], 'USUM72200002'))
  await clock.advance(5_000)
  expect(spotify.musicbrainz()).toHaveLength(2)
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
