//go:build !dev

package main

// devMode — false в `wails build`: БД сохраняется между запусками.
const devMode = false
