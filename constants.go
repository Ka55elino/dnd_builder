package main

const APP_NAME = "DnD-builder-v3"

// APP_VERSION is the application version — the single source for every file that
// carries it (build/config.yml, Info.plist, Windows/Linux/Android files):
// change it with `wails3 task version:set VERSION=x.y.z` (tools/version), not by hand.
// The database is one file for every version (dnd.db, see dbFileName): a new version
// refreshes the built-in reference data in it and keeps the user's records (seed.go).
const APP_VERSION = "0.5.7"

// GITHUB_REPO is where releases are published: the app checks the latest one (updates.go).
const GITHUB_REPO = "Ka55elino/dnd_builder"
