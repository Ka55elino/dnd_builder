//go:build dev

package main

// devMode — true при `wails dev` (Wails собирает с тегом dev).
// В dev-режиме БД удаляется при каждом запуске и собирается заново
// из db/schema + db/data (см. openDB).
const devMode = true
