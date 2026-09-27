//go:build production

package main

// devMode is false for release builds (`wails3 build` / `wails3 package` build with -tags production):
// the database persists between launches.
const devMode = false
