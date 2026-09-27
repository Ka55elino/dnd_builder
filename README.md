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

Build configuration: `Taskfile.yml` (root) + `build/config.yml` (name, identifier, version) + generated platform files in `build/<platform>/`. After changing `info` in `build/config.yml`, regenerate them: `wails3 task common:update:build-assets`. Icons for all platforms are generated from `build/appicon.png`.

A build for a given OS must be done **on that OS** (or in the Docker cross-build image, see `wails3 task setup:docker`). CI builds all three platforms, see below.

## Releases (CI)

`.github/workflows/release.yml` builds the app on GitHub Actions and publishes a GitHub Release:

1. Bump `APP_VERSION` in `constants.go` and `info.version` in `build/config.yml` (e.g. `"0.2.0"`) and commit.
2. Push a matching tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

The workflow checks that the tag matches `APP_VERSION` (the version is part of the DB file name) and `build/config.yml`, then builds with `wails3 task …`:

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
├── constants.go           # APP_NAME, APP_VERSION (the version is part of the DB file name)
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
│   ├── imagegen.py        # local image generation (Stable Diffusion via diffusers; prompt from an assets/data record)
│   └── img2b64.py         # image → PNG (optional background removal); --into puts it into assets/images + sets the JSON "image" path
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

### Generating images locally — `tools/imagegen.py`

Generates images with a local Stable Diffusion model through 🤗 diffusers: no API, no key, works offline after the first download. It runs on Apple Silicon (MPS), NVIDIA (CUDA) or, slowly, on the CPU.

```bash
pip3 install torch torchvision diffusers transformers accelerate safetensors pillow numpy
```

On the first run the model is downloaded from Hugging Face (~7 GB, cached in `~/.cache/huggingface`). For SDXL on a Mac, 16 GB of RAM or more is recommended.

**Models** (`--model`):

| Preset | Model | Size | Steps | Use for |
|---|---|---|---|---|
| `sdxl` (default) | `stabilityai/stable-diffusion-xl-base-1.0` | 1024 px | 30 | final images |
| `sdxl-turbo` | `stabilityai/sdxl-turbo` | 512 px | 4 | fast drafts |
| any Hugging Face id | a text-to-image pipeline | — | 30 | experiments |

**Prompts.** With `--from` the prompt is built from an `assets/data` record:

- species and classes become an **emblem**: name, parent class or species, and up to 3 feature names as symbols;
- equipment (weapons, armor, items, packs) becomes an **inventory icon** of the object itself.

A short house style and a negative prompt (no text, frames, people, clutter) are appended. The background is always plain black, so `img2b64.py --cut` removes it cleanly. Check the prompts without loading a model:

```bash
python3 tools/imagegen.py --from "assets/data/armor/heavy/*.json" --dry-run
```

**Typical workflow:**

```bash
# 1. fast drafts: 4 variants per record → tools/out/<id>-1.png … <id>-4.png (each with its seed)
python3 tools/imagegen.py --from "assets/data/armor/heavy/*.json" --model sdxl-turbo -n 4

# 2. final quality (or re-render a draft you liked: --seed <its seed> -n 1)
python3 tools/imagegen.py --from assets/data/armor/heavy/plate.json -n 4

# 3. put the chosen variant into the app
python3 tools/img2b64.py tools/out/plate-3.png --cut --size 512 --into assets/data/armor/heavy/plate.json
```

Or in one go (the first variant goes into the app): `--into`, with `--cut glow` for glowing subjects.

**Other options:**

| Option | What it does |
|---|---|
| `"text"` (positional) | a free-form prompt; with `--from` it is added to the record's prompt, e.g. `"gold trim, lion motif"` |
| `-n N` | number of variants (seeds `seed`, `seed+1`, …) |
| `--seed N` | fixed seed: the same seed and prompt give the same image |
| `--steps N`, `--guidance X`, `--size PX` | override the preset |
| `--refs N` | use N sibling icons (the parent and neighbours) as style references — IP-Adapter, SDXL only, ~3 GB extra download on first use |
| `--ref file.png`, `--ref-scale 0.5` | your own style reference and how strongly it steers the result (0–1) |
| `--no-style`, `--negative "…"` | drop the house style / replace the negative prompt |
| `--force` | with a glob: also records that already have a PNG image (by default they are skipped) |
| `--out DIR` | output folder (default `tools/out/`, git-ignored) |

