# Pixel Tunes

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that puts a pixel-art Spotify player in a pane next to your chat. The scene on top changes with the music that is playing.

<p align="center"><img src="docs/pane.gif" width="281" alt="The Pixel Tunes pane: a pixel-art night drive over Positif by Mr. Oizo, with its cover, the progress, the controls and the queue"></p>

## Scenes

Pixel Tunes has six scenes, one per family of music. Each one moves only while music plays (the stars always twinkle).

<table>
  <tr>
    <td width="186"><img src="docs/scenes/nightdrive.svg" width="160" alt="Pixel-art night drive: a setting sun behind the city, a neon grid and a car"></td>
    <td><b>Night Drive</b>, the default<br>synthwave, retrowave, outrun, vaporwave, darksynth, dreamwave</td>
  </tr>
  <tr>
    <td width="186"><img src="docs/scenes/campfire.svg" width="160" alt="Pixel-art campfire: a snowy pine forest under the stars, a log cabin with warm light and a crackling fire"></td>
    <td><b>Campfire</b><br>folk, indie folk, folk rock, folk pop, chamber folk, contemporary folk, alt-country, americana, country, bluegrass, singer-songwriter, folktronica, stomp and holler, acoustic</td>
  </tr>
  <tr>
    <td width="186"><img src="docs/scenes/citylights.svg" width="160" alt="Pixel-art city lights: a wet street in the rain, brick buildings with a water tower and a bar with a red neon sign"></td>
    <td><b>City Lights</b><br>rock of any kind (indie rock, garage rock, art rock…), punk and post-punk, new wave, indie, alternative, britpop, grunge, art pop, baroque pop, chamber pop</td>
  </tr>
  <tr>
    <td width="186"><img src="docs/scenes/dancefloor.svg" width="160" alt="Pixel-art dance floor: a disco ball over a floor of glowing tiles, a DJ between the speakers and laser beams"></td>
    <td><b>Dance Floor</b><br>house (French house, deep house…), disco and nu disco, dance, dance-punk, big beat, UK garage, techno, electroclash</td>
  </tr>
  <tr>
    <td width="186"><img src="docs/scenes/psychedelic.svg" width="160" alt="Pixel-art psychedelic: a desert at sunset, a big sun in rings of colour with turning rays, mesas and rippling sand"></td>
    <td><b>Psychedelic</b><br>psychedelic rock, pop and folk, neo-psychedelia, freak folk, surf, space rock, acid rock, krautrock</td>
  </tr>
  <tr>
    <td width="186"><img src="docs/scenes/dreampop.svg" width="160" alt="Pixel-art dream pop: a full moon over a mirroring lake, a slow aurora, mist over the water and reeds"></td>
    <td><b>Dream Pop</b><br>dream pop, shoegaze, slowcore, downtempo, ambient, ambient pop, chillwave, ethereal wave, trip hop</td>
  </tr>
</table>

Spotify no longer tells apps the genre of what plays, so Pixel Tunes picks the scene itself. The first rule that gives an answer wins:

1. **Your own pick.** The *Scene* button in the pane picks a scene until you go back to *Automatic*.
2. **A playlist you remembered.** After a pick, *Remember for this playlist* keeps it for the playlist that is playing.
3. **An artist you remembered.** *Remember for this artist* does the same for the artist. A guest on a track counts too.
4. **Words in the playlist's name.** *Indie Folk Evenings* gets Campfire, *Late Night Synthwave* gets Night Drive, *Lo-fi for coding* gets Dream Pop.
5. **The artist's genres on MusicBrainz**, only if you turn on `genre_lookup` (off by default). Of the artist's four most-voted genres, the first match in the order Night Drive, Dance Floor, Dream Pop, Campfire, Psychedelic, City Lights wins. Folk comes before psych and rock, so a folk band with a few psych tags still gets the campfire.
6. **Otherwise:** Night Drive.

## What it does

- Shows what is playing: album art, title, artist, progress and an animated scene.
- Controls Spotify: play and pause, previous and next, shuffle, repeat, like, volume, and a choice of device.
- Finds music without the Spotify app: search for tracks, albums, playlists and artists, browse your playlists and recently played, and add to the queue.
- Lets Claude be your DJ. Ask Claude to put something on ("play Nightcall by Kavinsky", "put on something for a late-night coding session") and it uses the `play_music` tool. Claude only hears a fixed status line, such as whether playback started, never titles or other Spotify data.
- Shows what plays in Claude's spinner: *Thinking · ♪ Nightcall – Kavinsky…*
- Has a demo mode, so you can look around before you connect Spotify.

The sound itself comes from a Spotify Connect device, such as the Spotify app on your Mac, your phone or a speaker: Pixel Tunes is the remote control and the screen.

## Requirements

- Claude Code with mods. The pixel-art pane draws in the desktop app's Code tab; a terminal session gets a short text version.
- macOS. Pixel Tunes keeps your login in the Keychain and uses `open`, `curl` and `python3` (from the Xcode Command Line Tools) to log in.
- Spotify Premium. Spotify needs it to control playback, and to own an app in Development Mode.
- A Spotify app of your own, for its Client ID. See below.

## Spotify setup

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and log in.
2. Click **Create app**. Fill in any name and description. As **Redirect URI**, add exactly `http://127.0.0.1:8898/callback` (Spotify does not accept `localhost`). Under the APIs used, tick **Web API**. Accept the terms and save.
3. Open the app's settings and copy its **Client ID**. You do not need the client secret: Pixel Tunes logs in with PKCE.

In Development Mode, an app works for at most five Spotify users. To share yours with someone, add them under **User Management**.

## Install

At the prompt of a terminal session:

```
/plugin install pixel-tunes --marketplace tijshuisman/claude-pixel-tunes
```

Answer `y` to add the marketplace, choose a scope, and fill in your Client ID when you are asked for the options.

From a shell:

```
claude plugin install pixel-tunes --marketplace tijshuisman/claude-pixel-tunes
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `tijshuisman/claude-pixel-tunes`, then **Add plugin**.

Then run `/tunes` to open the pane, and click **Connect Spotify**. Your browser opens Spotify's login; after you agree, the pane connects. If that page cannot reach Pixel Tunes, paste the address you land on into the pane.

## Update

By default, Pixel Tunes doesn't update by itself. To update, run this in a shell:

```
claude plugin update pixel-tunes@claude-pixel-tunes
```

Or, at the prompt of a terminal session, run `/plugin`, open Pixel Tunes on the **Installed** tab and select **Update now**.

To update automatically, turn on auto-update once, in a terminal session: run `/plugin`, go to the **Marketplaces** tab, pick `claude-pixel-tunes` and select **Enable auto-update**.

The new version loads in your next session, in the terminal and in the desktop app.

## Use

| Command | |
|---|---|
| `/tunes` | Open the pane |
| `/tunes play`, `/tunes pause` | Play or pause |
| `/tunes next`, `/tunes prev` | Next or previous track |
| `/tunes login`, `/tunes logout` | Connect to Spotify, or disconnect and remove the login from the Keychain |
| `/tunes debug` | Show how fetching the album art and the genre lookup went |

## Options

You set them when you install, and change them later in the config menu (`/config` in a terminal session).

| Option | Default | |
|---|---|---|
| `spotify_client_id` | none | The Client ID of your Spotify app |
| `callback_port` | `8898` | The port in your redirect URI. Change both together. |
| `genre_lookup` | off | Look up the playing artist's genres on MusicBrainz to pick the scene |

## Privacy

- Your Spotify login stays on your Mac. The refresh token is in the macOS Keychain (service `claude-pixel-tunes`); the access token only lives in memory.
- Your remembered scenes are stored by Claude Code on your Mac.
- Titles, artists and album art never go to the model. `play_music` only answers whether playback started, and `/tunes debug` leaves them out too.
- With `genre_lookup` on, the Spotify ID of the playing artist goes to [musicbrainz.org](https://musicbrainz.org), or the ISRC code of the track when MusicBrainz doesn't know that ID, until MusicBrainz has told Pixel Tunes the artist's genres; at most one request a second. With it off (the default), Pixel Tunes talks to Spotify only.

## Development

```
claude plugin validate pixel-tunes
claude plugin test pixel-tunes
```

The tests run against a fake Spotify and MusicBrainz. To load your working copy in every session, point `CLAUDE_CODE_PLUGIN_DIRS` at the `pixel-tunes` folder (in the `env` of `~/.claude/settings.json`).

## License

[MIT](LICENSE). Pixel Tunes is not affiliated with or endorsed by Spotify. Spotify is a trademark of Spotify AB.
