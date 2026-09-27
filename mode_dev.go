//go:build !production

package main

// devMode is true for development builds (`wails3 dev`, plain `go build`/`go run`):
// the database is deleted on every launch and rebuilt from db/schema + assets/data (see openDB).
// Release builds (`wails3 build`, `wails3 package`) use the production tag, see mode_prod.go.
const devMode = true
