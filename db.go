package main

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	_ "modernc.org/sqlite"
)

//go:embed db/schema/*.sql
var schemaFS embed.FS

// appDataDir is the folder for the database:
//   - iOS / Android: the app's private files directory (application.Mobile.StoragePath);
//   - desktop: <user config dir>/<APP_NAME> (~/Library/Application Support/… on macOS,
//     %AppData%\… on Windows, ~/.config/… on Linux).
func appDataDir() (string, error) {
	if p := application.Mobile.StoragePath(); p != "" { // "" on desktop
		return p, os.MkdirAll(p, 0o755)
	}
	if runtime.GOOS == "android" {
		// fallback: $HOME is not set for Android apps, so os.UserConfigDir fails
		if p := androidFilesDir(); p != "" {
			return p, os.MkdirAll(p, 0o755)
		}
	}

	base, err := os.UserConfigDir()

	if err != nil {
		return "", err
	}

	dir := filepath.Join(base, APP_NAME)

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}

	return dir, nil
}

// androidFilesDir: /data/data/<package>/files — the process name of an Android app is its package name.
func androidFilesDir() string {
	b, err := os.ReadFile("/proc/self/cmdline")
	if err != nil {
		return ""
	}
	pkg := strings.TrimRight(strings.SplitN(string(b), "\x00", 2)[0], "\x00")
	if pkg == "" || strings.ContainsAny(pkg, "/ ") {
		return ""
	}
	return filepath.Join("/data/data", pkg, "files")
}

// dbFileName returns the database file name including the app version: dnd-v0.1.0.db.
// In dev mode a separate file (dnd-dev-v0.1.0.db) is used so the working database is not overwritten.
func dbFileName() string {
	if devMode {
		return fmt.Sprintf("dnd-dev-v%s.db", APP_VERSION)
	}
	return fmt.Sprintf("dnd-v%s.db", APP_VERSION)
}

// removeDB deletes the database file along with its WAL/SHM files (missing files are not an error).
func removeDB(path string) error {
	for _, p := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func openDB() (db *sql.DB, err error) {
	dir, err := appDataDir()
	if err != nil {
		return nil, err
	}

	path := filepath.Join(dir, dbFileName())

	if devMode {
		// dev: always a fresh database; schema and seeds are applied again
		if err := removeDB(path); err != nil {
			return nil, err
		}
		log.Printf("[dev] database recreated: %s", path)
	}

	db, err = sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	for _, p := range []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA foreign_keys = ON;",
		"PRAGMA busy_timeout = 5000;",
	} {
		if _, err := db.Exec(p); err != nil {
			db.Close()
			return nil, err
		}
	}

	if err := initSchema(db); err != nil {
		db.Close()
		return nil, err
	}

	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func initSchema(db *sql.DB) error {
	files, err := fs.Glob(schemaFS, "db/schema/*.sql")

	if err != nil {
		return err
	}

	for _, f := range files {
		b, err := schemaFS.ReadFile(f)
		if err != nil {
			return err
		}

		if _, err := db.Exec(string(b)); err != nil {
			return fmt.Errorf("%s: %w", f, err)
		}
	}

	return nil
}

// migrate applies schema changes to existing databases
// (CREATE TABLE IF NOT EXISTS does not add new columns to an old table).
func migrate(db *sql.DB) error {
	// image column: if it had to be added, the built-in records were
	// loaded without images, so delete them and seedAll reloads them from JSON.
	// User-defined records (is_custom = 1) are left untouched.
	// Order matters: subclasses before classes (foreign key).
	for _, table := range []string{"races", "subclasses", "classes"} {
		added, err := ensureColumn(db, table, "image", "TEXT")
		if err != nil {
			return err
		}
		if added {
			if _, err := db.Exec(fmt.Sprintf("DELETE FROM %s WHERE is_custom = 0", table)); err != nil {
				return err
			}
		}
	}
	// state_json on characters: just add it, existing data is left untouched
	if _, err := ensureColumn(db, "characters", "state_json", "TEXT"); err != nil {
		return err
	}
	// custom equipment (the "Items" page): is_custom and timestamps on old tables
	for _, table := range []string{"weapons", "armor", "items"} {
		if _, err := ensureColumn(db, table, "is_custom", "INTEGER NOT NULL DEFAULT 0"); err != nil {
			return err
		}
	}
	return nil
}

// ensureColumn adds a column if it does not exist. It returns true if the column was added.
func ensureColumn(db *sql.DB, table, column, def string) (bool, error) {
	rows, err := db.Query(fmt.Sprintf("SELECT name FROM pragma_table_info('%s')", table))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return false, err
		}
		if name == column {
			return false, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	rows.Close()

	_, err = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, def))
	return err == nil, err
}
