import type { ThemeId } from '../../types'
import { campfire } from './campfire'
import { citylights } from './citylights'
import { dancefloor } from './dancefloor'
import { dreampop } from './dreampop'
import { flateric } from './flateric'
import { nightdrive } from './nightdrive'
import { psychedelic } from './psychedelic'

// The themes the scene can take. A theme is a family of music with a scene of
// its own: layers of SVG, back to front, that animate only while music plays
// (stars may always twinkle). The pane frames them in one Svg.

/** A scene's layers, back to front. */
export type Scene = (isPlaying: boolean) => readonly string[]

export type Theme = {
  /** The name in the pane. */
  name: string
  /** What the scene shows, as the Svg's alt. */
  alt: string
  /** Its scene. */
  scene: Scene
}

export const THEMES: Readonly<Record<ThemeId, Theme>> = {
  nightdrive: {
    name: 'Night Drive',
    alt: 'Pixel-art night drive: a setting sun behind the city, a neon grid and a car',
    scene: nightdrive,
  },
  campfire: {
    name: 'Campfire',
    alt: 'Pixel-art campfire: a snowy pine forest under the stars, a log cabin with warm light and a crackling fire',
    scene: campfire,
  },
  citylights: {
    name: 'City Lights',
    alt: 'Pixel-art city lights: a wet street in the rain, brick buildings with a water tower and a bar with a red neon sign',
    scene: citylights,
  },
  dancefloor: {
    name: 'Dance Floor',
    alt: 'Pixel-art dance floor: a disco ball over a floor of glowing tiles, a DJ between the speakers and laser beams',
    scene: dancefloor,
  },
  psychedelic: {
    name: 'Psychedelic',
    alt: 'Pixel-art psychedelic: a desert at sunset, a big sun in rings of colour with turning rays, mesas and rippling sand',
    scene: psychedelic,
  },
  dreampop: {
    name: 'Dream Pop',
    alt: 'Pixel-art dream pop: a full moon over a mirroring lake, a slow aurora, mist over the water and reeds',
    scene: dreampop,
  },
  flateric: {
    name: 'Flat Eric',
    alt: 'Pixel-art flat eric: the yellow puppet in a gilded room, a sausage in his mouth, nodding to the beat beside a speaker and a bowl of sausages',
    scene: flateric,
  },
}

/** The families in the order the pane lists them. */
export const THEME_IDS: readonly ThemeId[] = ['nightdrive', 'campfire', 'citylights', 'dancefloor', 'psychedelic', 'dreampop']
