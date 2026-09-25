//go:build !dev

package main

// devMode is false under `wails build`: the database persists between launches.
const devMode = false
