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
├── seed.go                # fills empty tables from db/data/*.json on startup
├── queries.go             # loads named SQL queries from db/queries (Q("Name"))
├── races.go, classes.go   # races/subraces, classes/subclasses
├── equipment.go           # weapons, armor, items, packs, catalog
├── rules.go               # backgrounds, feats, spells and class/species abilities
├── characters.go          # saving/loading characters and their play state
├── custom_equipment.go    # user-created items, armor, weapons and spells
├── enums/                 # shared Go enums (action types, spell schools/levels)
├── db/
│   ├── schema/            # CREATE TABLE … for every table (*.sql, embedded)
│   ├── queries/           # named queries: "-- name: QueryName" + SQL
│   └── data/              # reference data in JSON (seeded into empty tables)
│       ├── races/         #   <race>/<race>.json + subraces/*.json (images as base64)
│       ├── classes/       #   <class>/<class>.json + subclasses/*.json
│       ├── spells/        #   spells by school/level, class/subclass/species abilities
│       ├── feats/  backgrounds/
│       ├── weapons/  armor/  items/  packs/
│       └── characters/    #   sample characters (seeded in dev mode only)
├── tools/
│   └── img2b64.py         # image → PNG → base64 for the "image" field (optional background removal)
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
import { SaveCharacter, ListCharacters } from '../wailsjs/go/main/App';

const id = await SaveCharacter(JSON.stringify(build));
const list = await ListCharacters();
```

Under the hood, the arguments are serialized to JSON, passed to Go through the webview's native bridge, the method runs (writing to SQLite), and the result is sent back and resolves the promise. A Go error (`error`) arrives as a `reject`.
