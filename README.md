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
├── main.go            # entry point: window, webview, frontend embed, Go method bindings
├── app.go             # Go methods called from the frontend (SaveCharacter, LoadAll, …)
├── wails.json         # Wails config: name, frontend build/dev commands
├── go.mod / go.sum    # Go dependencies
├── frontend/          # Vite project (frontend)
│   ├── index.html
│   ├── package.json
│   ├── src/           # UI source code
│   └── wailsjs/       # auto-generated wrappers for calling Go from JS
└── build/
    ├── appicon.png    # app icon
    ├── darwin/        # Info.plist etc. for macOS
    ├── windows/       # Windows resources
    └── bin/           # the app is built HERE (in .gitignore)
```

## How the frontend talks to Go

The built app has **no HTTP server**. The frontend and Go live in the same process; the webview is the system one (WebKit on macOS). Go methods bound in `main.go` (`Bind`) are automatically turned by Wails into JS functions in `frontend/wailsjs/go/...`. Calling them from JS looks like a regular `await`:

```js
import { SaveCharacter, LoadAll } from '../wailsjs/go/main/App';

const id = await SaveCharacter(JSON.stringify(build));
const list = await LoadAll();
```

Under the hood, the arguments are serialized to JSON, passed to Go through the webview's native bridge, the method runs (writing to SQLite), and the result is sent back and resolves the promise. A Go error (`error`) arrives as a `reject`.
