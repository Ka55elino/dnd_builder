# D&D Builder v3

A desktop D&D character builder built with **Wails** (Go + webview), with a **Svelte 5 + Vite** frontend and **SQLite** storage. A web version (a single `index.html` that runs from `file://`, with IndexedDB storage) is built separately from the same frontend.

Stack: **Go** (backend, database) + **Wails v2** (desktop shell, JS↔Go bridge) + **Svelte 5 + Vite** (frontend) + **SQLite** (`modernc.org/sqlite`, pure Go, no CGO).

## Requirements

- **Go** 1.21+ (the project uses 1.25)
- **Node.js** 20.19+ or 22.12+ and npm
- **Wails CLI** v2
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)

Install the Wails CLI (it is compiled into `~/go/bin`, which must be on your `PATH`):

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Check your environment (Go, compilers, webview dependencies, npm):

```bash
wails doctor
```

## Installing dependencies

Go dependencies are fetched automatically on the first build. Frontend dependencies:

```bash
cd frontend && npm install && cd ..
```

Or all at once through Wails (it uses `frontend:install` from `wails.json`):

```bash
wails build   # the first run installs the frontend dependencies itself
```

## Development

```bash
wails dev
```

What the command does:

- starts the Vite dev server with hot module replacement (HMR), so changes in `frontend/src` show up instantly;
- compiles the Go code and opens the native app window with a webview;
- keeps the JS↔Go bridge alive, so calls to Go methods from the frontend work just like in production;
- additionally serves `http://localhost:34115`: open it in Chrome to debug the frontend in the familiar DevTools with access to the Go methods.

This is the main way to work on the app. `localhost` here is only a development tool; the built app has no server.

## Building

```bash
wails build
```

Builds the frontend (`npm run build`), embeds it into the Go binary via `//go:embed` and compiles the native app into **`build/bin/`**.

Useful flags:

```bash
wails build -platform darwin/universal   # macOS: Intel + Apple Silicon in a single .app
wails build -clean                       # clean rebuild
wails build -upx                         # compress the binary (requires upx)
wails build -nsis                        # Windows: build an installer
```

A build for a given OS must be done **on that OS** (the webview is native and cannot be cross-compiled). To build for all three platforms at once, use CI (GitHub Actions with a macOS/Windows/Linux matrix).

## Web version (no desktop)

The same frontend can be built into a single self-contained `index.html` that runs from `file://` (storage is IndexedDB instead of SQLite):

```bash
cd frontend && npm run build
```

The output goes to `frontend/dist/`.

## Project structure

```
dnd-builder-v3/
├── main.go                # entry point: window, webview, embedded frontend, Go bindings, Linux icon
├── app.go                 # Go methods called from the frontend (GetRaces, SaveCharacter, SaveCustomSpell, …)
├── constants.go           # APP_NAME, APP_VERSION (the version is part of the DB file name)
├── mode_dev.go            # devMode = true  (`wails dev`: the DB is recreated on every start)
├── mode_prod.go           # devMode = false (`wails build`: the DB persists)
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
│   ├── wailsjs/           # auto-generated JS wrappers for the Go methods (don't edit)
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
└── build/
    ├── appicon.png        # app icon source (1024×1024); .icns/.ico are generated from it
    ├── darwin/            # Info.plist for macOS
    ├── windows/           # icon.ico, manifest, installer
    └── bin/               # build output (in .gitignore)
```

## How the frontend talks to Go

The built app has **no HTTP server**. The frontend and Go live in the same process; the webview is the system one (WebKit on macOS). Go methods bound in `main.go` (`Bind`) are automatically turned by Wails into JS functions in `frontend/wailsjs/go/...`. Calling them from JS looks like a regular `await`:

```js
import { SaveCharacter, ListCharacters } from './api.js'; // the wailsjs bindings + the query loader

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

Restart `wails dev` afterwards: in dev mode the DB is recreated and reseeded on every start.

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

