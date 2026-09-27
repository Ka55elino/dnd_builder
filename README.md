# D&D Builder v3

A desktop D&D character builder built with **Wails** (Go + webview), with a **Svelte 5 + Vite** frontend and **SQLite** storage. A web version (a single `index.html` that runs from `file://`, with IndexedDB storage) is built separately from the same frontend.

Stack: **Go** (backend, database) + **Wails v3** (desktop shell, JS↔Go bridge; currently in beta) + **Svelte 5 + Vite** (frontend) + **SQLite** (`modernc.org/sqlite`, pure Go, no CGO).

## Requirements

- **Go** 1.25+
- **Node.js** 20.19+ or 22.12+ and npm
- **Wails CLI** v3 (`wails3`)
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)
- **Linux:** GTK4 + WebKitGTK 6.0 dev packages (Ubuntu 24.04: `libgtk-4-dev libwebkitgtk-6.0-dev`)

Install the Wails CLI (it is compiled into `~/go/bin`, which must be on your `PATH`), use the same version as `github.com/wailsapp/wails/v3` in `go.mod`:

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@latest
wails3 doctor   # checks Go, compilers, webview dependencies, npm
```

## Development

```bash
wails3 dev
```

What the command does (configured in `build/config.yml` → `dev_mode`):

- generates the JS bindings for the Go `App` service into `frontend/bindings/` (git-ignored);
- starts the Vite dev server (port 9245) with hot module replacement, so changes in `frontend/src` show up instantly;
- builds the Go code without the `production` tag (dev mode: the DB is recreated on every start, sample characters are seeded) and opens the app window;
- rebuilds and restarts the app when `.go`, `.json` (assets/data) or `.sql` files change.

`wails3 task --list` shows all tasks (build, package, per-platform tasks).

## Testing the LAN game without a second device

Two console tools stand in for the other side of a game (`tools/fakeplayer`, `tools/fakegame`).
Run them **from the project root** in a separate terminal while the app is running (`wails3 dev`).
Both use the real network code (`lan/`), so they talk to the app exactly like another copy of it would.

Don't start a second copy of the app on the same Mac instead: in dev mode it recreates the database on start.

### `fakeplayer` — fake players for the DM screen ("Start Game")

1. In the app: **Start Game** → enter a name → Submit.
2. In a terminal:

   ```bash
   go run ./tools/fakeplayer                        # 1 player → 127.0.0.1:47800
   go run ./tools/fakeplayer -n 3                   # 3 players with different characters
   go run ./tools/fakeplayer -character rogue       # a specific character (id or part of the name)
   go run ./tools/fakeplayer -name Bruenor          # rename the character (-n 3 → Bruenor 1, 2, 3)
   go run ./tools/fakeplayer -list                  # which characters are available and where from
   go run ./tools/fakeplayer -addr 192.168.1.42:47800   # a DM on another machine
   go run ./tools/fakeplayer -discover              # only list the games found on the network (mDNS)
   ```

Each fake player joins with a **real character**: a random one from the app's database (the newest
`dnd-*.db` in `~/Library/Application Support/DnD-builder-v3/`, override with `-db <file>`), or from
the seed files in `assets/data/characters/` if there is no database (`-seeds <dir>`). So the DM sees full
character cards in the party.

It behaves like the player's app: it applies the DM's Damage / Heal / Temp HP and reports the new state
back (the card updates), and prints whispers and gifts from the DM in the console (gifts are not stored —
it has no database of its own). Leaving (`quit` or Ctrl+C) removes its card from the DM's screen.

Console commands, after joining:

| Command | What it does |
|---|---|
| `roll {"d":20,"value":17}` | sends an event `roll` with that JSON to the DM, from every fake player |
| `ping` | an event without data |
| `quit` | leave the game (Ctrl+C works too) |

### `fakegame` — a fake DM for the player screen ("Join Game")

1. In a terminal:

   ```bash
   go run ./tools/fakegame                     # "Test Game" on port 47800 (or the next free one)
   go run ./tools/fakegame -name "Lost Mine"
   ```

2. In the app: **Join Game** → the game shows up in the list (mDNS); if it doesn't, connect by address
   `127.0.0.1:47800` → pick a character. The app must not be hosting a game itself (the port is taken).

It prints who joins and leaves and every event the players send (their character state after each change).
Console commands — the same actions as the buttons on the DM's player card:

| Command | What it does |
|---|---|
| `players` | list the players: id, name, class, level |
| `w grom You hear a click behind you.` | whisper: a popup only that player sees, until they close it |
| `dmg grom 5` · `heal grom 3` · `temp grom 4` | Damage / Heal / set Temp HP |
| `items` | the named items that can be given (from `assets/data`, or `-data <dir>`) |
| `give grom dawnbringer` · `give grom elven chain 2` | give an item (id or part of its name) and a quantity: it lands in the character's backpack |
| `start {"round":1}` | any event with JSON, to all players |
| `@grom hp {"op":"damage","amount":5}` | any event to one player |
| `quit` | end the game (Ctrl+C works too): players see "The DM ended the game" |

`<player>` is the full name, its first word (`grom` for "Grom Stonejaw") or the start of the player id
(see `players`); case doesn't matter.

### Both at once, and the network part

- `fakegame` + `fakeplayer` also work together without the app — handy to watch the protocol in the console.
- To check that a game is visible on the network at all (without our code): `dns-sd -B _dndbuilder._tcp` (macOS).
- The network layer has its own tests: `go test -race ./lan` (host + player, events, leave/rejoin, reconnect).

## Building

```bash
wails3 build     # binary for the current OS → bin/dnd-builder-v3
wails3 package   # packaged app: .app (macOS), NSIS installer (Windows), AppImage/deb/rpm (Linux) → bin/
```

Release builds use the `production` build tag: the database persists between launches (`mode_prod.go`). Plain `go build` / `go run` without it is a dev build. Useful platform tasks:

```bash
wails3 task darwin:package:universal   # macOS: Intel + Apple Silicon in one .app
wails3 task windows:package            # Windows: .exe + NSIS installer (needs makensis)
wails3 task linux:build                # Linux binary
```

Build configuration: `Taskfile.yml` (root) + `build/config.yml` (name, identifier, version) + generated platform files in `build/<platform>/`. After changing `info` in `build/config.yml` (other than the version — see [Version](#version)), regenerate them: `wails3 task common:update:build-assets` (this overwrites manual edits in those files). Icons for all platforms are generated from `build/appicon.png`.

A build for a given OS must be done **on that OS** (or in the Docker cross-build image, see `wails3 task setup:docker`). CI builds all three platforms, see below.

## Version

The version lives in one place — `APP_VERSION` in `constants.go`. Every other file that carries it
(`build/config.yml`, `Info.plist` for macOS/iOS, the Windows, Linux and Android packaging files) is
updated from it by `tools/version`, which changes only the version strings, so manual edits in those
files are kept (unlike `wails3 task common:update:build-assets`, which regenerates them):

```bash
wails3 task version                      # show the version and check every file carries it
wails3 task version:set VERSION=0.3.1    # set a new version everywhere
wails3 task version:sync                 # APP_VERSION was edited by hand: copy it to the other files
```

Without the Taskfile: `go run ./tools/version`, `go run ./tools/version 0.3.1`, `go run ./tools/version -sync`.

The version is part of the database file name (`dnd-v<version>.db`), so a new version starts with its
own fresh database.

## Releases (CI)

`.github/workflows/release.yml` builds the app on GitHub Actions and publishes a GitHub Release:

1. Set the version and commit:

   ```bash
   wails3 task version:set VERSION=0.3.1
   git add -A
   git commit -m "Release 0.3.1"
   ```

2. Push a matching tag:

   ```bash
   git tag -a v0.3.1 -m "v0.3.1"
   git push origin master
   git push origin v0.3.1
   ```

The workflow checks that every file carries `APP_VERSION` (`go run ./tools/version`) and that the tag matches it, then builds with `wails3 task …`:

| Platform | Runner | Files |
|---|---|---|
| macOS (Intel + Apple Silicon) | `macos-latest` | `dnd-builder-v3-<ver>-macos-universal.zip` (the .app) |
| Windows x64 | `windows-latest` | `…-windows-amd64.zip` (the .exe) and `…-windows-amd64-installer.exe` (NSIS) |
| Linux x64 | `ubuntu-24.04` | `…-linux-amd64.tar.gz` (needs GTK4 and WebKitGTK 6.0: `libgtk-4-1 libwebkitgtk-6.0-4`) |
| Android (arm64 + x86_64) | `ubuntu-latest` | `…-android.apk` — signed with the debug keystore, or with your own if the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` secrets are set |
| iOS Simulator | `macos-latest` | `…-ios-simulator.zip` (the .app; a device `.ipa` needs an Apple Developer certificate) |

Mobile support in Wails v3 is experimental: the Android and iOS jobs may fail without blocking the release (the desktop files are published anyway).

Then it creates the release with these files and auto-generated notes. A tag with a suffix (`v0.2.0-beta.1`) becomes a pre-release. **Actions → Release → Run workflow** builds without releasing (the files are in the run's artifacts).

The builds are not code-signed: on macOS open the app the first time with right-click → Open (or `xattr -dr com.apple.quarantine "dnd-builder-v3.app"`); on Windows SmartScreen asks for confirmation.

## Web version (no desktop)

The same frontend can be built into a single self-contained `index.html` that runs from `file://` (storage is IndexedDB instead of SQLite):

```bash
cd frontend && npm run build
```

The output goes to `frontend/dist/`.

## Project structure

```
dnd-builder-v3/
├── main.go                # entry point: application, window, embedded frontend, App service, /img/ middleware
├── app.go                 # Go methods called from the frontend (GetRaces, SaveCharacter, SaveCustomSpell, …)
├── constants.go           # APP_NAME, APP_VERSION — the single source of the version (part of the DB file name)
├── mode_dev.go            # devMode = true  (no `production` tag, `wails3 dev`: the DB is recreated on every start)
├── mode_prod.go           # devMode = false (`production` tag, `wails3 build`: the DB persists)
├── Taskfile.yml           # Wails v3 build tasks (includes build/<platform>/Taskfile.yml)
├── db.go                  # opening SQLite, schema, migrations; DB file: dnd[-dev]-v<version>.db
├── seed.go                # fills empty tables from assets/data/*.json on startup
├── queries.go             # loads named SQL queries from db/queries (Q("Name"))
├── races.go, classes.go   # races/subraces, classes/subclasses
├── equipment.go           # weapons, armor, items, packs, catalog
├── rules.go               # backgrounds, feats, spells and class/species abilities
├── characters.go          # saving/loading characters and their play state
├── custom_equipment.go    # user-created items, armor, weapons and spells
├── images.go              # /img/… handler: built-in images (assets/images) and uploaded ones (images table)
├── enums/                 # shared Go enums (action types, spell schools/levels)
├── db/
│   ├── schema/            # CREATE TABLE … for every table (*.sql, embedded)
│   └── queries/           # named queries: "-- name: QueryName" + SQL
├── assets/                # embedded into the binary
│   ├── data/              # reference data in JSON (seeded into empty tables)
│   │   ├── races/         #   <race>/<race>.json + subraces/*.json ("image": "/img/races/…")
│   │   ├── classes/       #   <class>/<class>.json + subclasses/*.json
│   │   ├── spells/        #   spells by school/level, class/subclass/species abilities
│   │   ├── feats/  backgrounds/
│   │   ├── weapons/  armor/  items/  packs/
│   │   └── characters/    #   sample characters (seeded in dev mode only)
│   └── images/            # built-in images, same paths as assets/data (served as /img/…)
├── tools/
│   ├── img2b64.py         # image → PNG (optional background removal); --into puts it into assets/images + sets the JSON "image" path
│   ├── fakeplayer/        # fake players for testing the DM screen (see "Testing the LAN game")
│   ├── fakegame/          # a fake DM for testing the player screen
│   └── version/           # sets/checks the app version in every file from APP_VERSION (see "Version")
├── frontend/              # Svelte 5 + Vite
│   ├── index.html
│   ├── package.json
│   ├── bindings/          # generated JS bindings for the Go App service (git-ignored, don't edit)
│   └── src/
│       ├── main.js, App.svelte      # entry point and screen switching
│       ├── components/              # screens: menu, characters, character sheet, level up,
│       │   │                        #   spells and items reference, editors, "Give item"
│       │   ├── builder/             #   character builder tabs (Basics, Abilities, Species, Class, Equipment)
│       │   └── common/              #   ActionCard, CatalogList, Icon, IconLabel, Tooltip
│       ├── models/                  # CharacterBuild (player choices), Character (derived sheet),
│       │                            #   CharacterState (HP, resources, slots, notes)
│       ├── rules/                   # game rules: progression, sheet, passives, spellcasting, labels…
│       ├── data/refs.js             # loads and caches reference data from Go
│       ├── styles/                  # colors, fonts, CSS variables
│       └── assets/                  # fonts and SVG icons (assets/icons/README.md)
├── build/
│   ├── config.yml         # Wails v3 project config: product info/version, dev mode
│   ├── appicon.png        # app icon source (1024×1024); platform icons are generated from it
│   ├── Taskfile.yml       # common tasks (bindings, frontend build) — generated
│   └── darwin/ windows/ linux/ ios/ android/   # platform tasks and packaging files — generated
└── bin/                   # build output (in .gitignore)
```

## How the frontend talks to Go

The built app has **no HTTP server**. The frontend and Go live in the same process; the webview is the system one (WebKit on macOS). The exported methods of the `App` service (registered in `main.go`) are turned by the Wails binding generator into JS functions in `frontend/bindings/dnd-builder-v3/app.js`; the frontend calls them through `frontend/src/api.js`. Calling them from JS looks like a regular `await`:

```js
import { SaveCharacter, ListCharacters } from './api.js'; // the generated bindings + the query loader

const id = await SaveCharacter(JSON.stringify(build));
const list = await ListCharacters();
```

Under the hood, the arguments are serialized to JSON, passed to Go through the webview's native bridge, the method runs (writing to SQLite), and the result is sent back and resolves the promise. A Go error (`error`) arrives as a `reject`.

## Images

Images are files, not base64: a record stores a URL in its `image` field (`portrait` for characters), and Go serves it (`images.go`):

| URL | Where the file is |
|---|---|
| `/img/races/elf/subraces/drow.png` | built-in image: `assets/images/…`, same path as the record in `assets/data/…`, embedded into the binary |
| `/img/db/<id>` | uploaded by the user (portrait, custom item): the `images` table in SQLite |

The frontend just renders `<img src={x.image}>`. When a record with a data URL is saved (an uploaded portrait or item picture), Go moves the image into the `images` table and stores its `/img/db/…` URL; unused uploads are deleted on startup.

### Adding an image to a record — `tools/img2b64.py`

Requires Pillow and numpy: `pip3 install pillow numpy`.

```bash
# remove the dark background, downscale to 512 px, save to assets/images/… and set "image" in the JSON
python3 tools/img2b64.py drow.jpeg --cut --size 512 --into assets/data/races/elf/subraces/drow.json
```

| Option | Use for |
|---|---|
| `--cut` (`solid`) | figures, medallions, emblems with a dark inside (the inside stays solid) |
| `--cut glow` | glow, fire, lightning, swirls (no dark ring around the glow) |
| `--cut-threshold N`, `--cut-close N` | manual tuning (see `--help`) |
| `--cut-holes 0.005` | also clear background seen through gaps (arches, antlers); not for medallions |
| `--cut-bg 247,243,235` | set the background color when the object covers most of the border and it is detected wrong |
| `--png out.png` | also save the resulting PNG, e.g. to compare the presets |

Restart `wails3 dev` afterwards: in dev mode the DB is recreated and reseeded on every start.
