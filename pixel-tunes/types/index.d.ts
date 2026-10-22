/** Placeholder artwork for the demo: a gradient with a sun. */
export type Cover = {
  /** Background top, background middle, sun, horizon line. */
  colors: [string, string, string, string]
  /** Sun centre x, centre y and radius, on a 24×24 grid. */
  sun: [number, number, number]
}

export type Track = {
  id: string
  /** `spotify:track:…`; absent in the demo. */
  uri?: string
  title: string
  artist: string
  album: string
  durationMs: number
  /** The demo's drawn placeholder. */
  cover?: Cover
  /** Spotify's artwork, about 300 px. */
  imageUrl?: string
  /** Each artist on its own, for choosing the scene; absent in the demo. */
  artists?: string[]
  /** The recording's ISRC, for the opt-in genre lookup. */
  isrc?: string
}

export type RepeatMode = 'off' | 'context' | 'track'

/**
 * What plays now. The position is a snapshot: `positionMs` as measured at
 * `at` (ms since the epoch), so a drawing never needs the clock.
 */
export type Playback = {
  track: Track | null
  isPlaying: boolean
  positionMs: number
  at: number
  shuffle: boolean
  repeat: RepeatMode
  /** 0 to 100. */
  volume: number
  /** The Spotify Connect device that plays; '' when none. */
  device: string
  /** The playlist or album playing (`spotify:…`), when there is one. */
  context?: string
}

export type Device = {
  id: string
  name: string
  type: string
  isActive: boolean
}

export type Account =
  | { status: 'demo' }
  | { status: 'connecting'; url: string; hint?: string }
  | { status: 'connected'; name: string }
  | { status: 'error'; message: string }

/** The track's artwork as a data URI, so the sandboxed Svg needs no network. */
export type Artwork = {
  url: string
  dataUri: string
}

/** Which list the pane shows under the controls. */
export type View = 'queue' | 'search' | 'playlists' | 'recent'

/** Something to play: a search result, a playlist, a recently played track. */
export type Item = {
  kind: 'track' | 'album' | 'playlist' | 'artist'
  /** `spotify:<kind>:<id>`. */
  uri: string
  title: string
  /** Artist, owner and size, or year: one line. */
  subtitle: string
  /** For a track, the album or playlist to play it in, so the music goes on after it. */
  context?: string
}

export type Browse = {
  view: View
  query: string
  search: Item[]
  playlists: Item[]
  /** Whether Spotify has more playlists past those listed. */
  hasMorePlaylists: boolean
  recent: Item[]
  /** The list being fetched, if any. */
  loading: View | null
  /** A line about the list: nothing found, or what went wrong. */
  message: string | null
}

/** The scene's families, each with a scene of its own. */
export type ThemeId = 'nightdrive' | 'campfire' | 'citylights' | 'dancefloor' | 'psychedelic' | 'dreampop'

/** The rule that chose the scene: a playlist or artist remembered, the playlist's name, MusicBrainz, or none. */
export type ThemeReason = 'playlist' | 'artist' | 'playlistName' | 'musicbrainz' | 'default'

/** Which scene the pane shows, and why. */
export type ThemeChoice = {
  /** What the rules choose for what plays now. */
  auto: ThemeId
  /** The rule that chose it. */
  reason: ThemeReason
  /** The artist or playlist the rule went by, for the pane; '' when none. */
  basis: string
  /** The person's own pick in the pane, over every rule; null is automatic. */
  manual: ThemeId | null
  /** Whether the list of themes is open in the pane. */
  isPicking: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'pixel-tunes': {
      playback: Playback
      queue: Track[]
      /** Ids of the tracks known to be saved to the library. */
      liked: string[]
      account: Account
      artwork: Artwork | null
      /** Devices to pick from while the picker is open; null when closed. */
      devices: Device[] | null
      /** A line for the person: what went wrong, or what to do next. */
      notice: string | null
      /** The tabs under the controls: queue, search, playlists, recent. */
      browse: Browse
      /** The scene's theme: chosen by the rules, or by the person. */
      theme: ThemeChoice
    }
  }
}
