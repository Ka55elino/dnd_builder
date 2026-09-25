//go:build dev

package main

// devMode is true under `wails dev` (Wails builds with the dev tag).
// In dev mode the database is deleted on every launch and rebuilt
// from db/schema + db/data (see openDB).
const devMode = true
