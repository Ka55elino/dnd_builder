package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"dnd-builder-v3/lan"

	_ "modernc.org/sqlite"
)

// appDirName must match APP_NAME in constants.go (the app's data folder).
const appDirName = "DnD-builder-v3"

// fakeChar is a character a fake player joins with.
type fakeChar struct {
	info lan.PlayerInfo
	snap lan.Snapshot
}

// loadCharacters reads characters from the app's database (dbPath, or the
// newest dnd-*.db in the app data folder); if there is none or it is empty,
// from the seed files in seedDir. Returns the characters and where they came from.
func loadCharacters(dbPath, seedDir string) ([]fakeChar, string, error) {
	if dbPath == "" {
		dbPath = findDB()
	}
	if dbPath != "" {
		chars, err := fromDB(dbPath)
		if err == nil && len(chars) > 0 {
			return chars, dbPath, nil
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "database %s: %v — using seed files\n", dbPath, err)
		}
	}
	chars, err := fromSeeds(seedDir)
	return chars, seedDir, err
}

// findDB returns the most recently modified app database, or "".
func findDB() string {
	base, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	matches, _ := filepath.Glob(filepath.Join(base, appDirName, "dnd-*.db"))
	best, bestTime := "", int64(0)
	for _, m := range matches {
		if st, err := os.Stat(m); err == nil && st.ModTime().UnixNano() > bestTime {
			best, bestTime = m, st.ModTime().UnixNano()
		}
	}
	return best
}

func fromDB(path string) ([]fakeChar, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.Query(`
		SELECT ch.id, ch.name, ch.level, COALESCE(c.name, ''), COALESCE(ch.portrait, ''),
		       ch.build_json, COALESCE(ch.state_json, '')
		FROM characters ch
		LEFT JOIN classes c ON c.id = ch.class_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []fakeChar
	for rows.Next() {
		var (
			c                  fakeChar
			buildRaw, stateRaw string
		)
		if err := rows.Scan(&c.info.CharacterID, &c.info.Name, &c.info.Level, &c.info.ClassName,
			&c.info.Portrait, &buildRaw, &stateRaw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(buildRaw), &c.snap.Build); err != nil {
			continue
		}
		if stateRaw != "" {
			_ = json.Unmarshal([]byte(stateRaw), &c.snap.State)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// fromSeeds reads the sample characters the app seeds in dev mode.
func fromSeeds(dir string) ([]fakeChar, error) {
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	sort.Strings(files)
	var out []fakeChar
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var build map[string]any
		if json.Unmarshal(raw, &build) != nil {
			continue
		}
		c := fakeChar{snap: lan.Snapshot{Build: build}}
		c.info.CharacterID, _ = build["id"].(string)
		c.info.Name, _ = build["name"].(string)
		c.info.Portrait, _ = build["portrait"].(string)
		if lvl, ok := build["level"].(float64); ok {
			c.info.Level = int(lvl)
		}
		if cls, _ := build["classId"].(string); cls != "" {
			c.info.ClassName = strings.ToUpper(cls[:1]) + cls[1:]
		}
		out = append(out, c)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no characters: no app database found and no seed files in %s "+
			"(run from the project root, or pass -db / -seeds)", dir)
	}
	return out, nil
}

// withName returns a copy of the character under another name (lobby and sheet).
func (c fakeChar) withName(name string) fakeChar {
	build := make(map[string]any, len(c.snap.Build))
	for k, v := range c.snap.Build {
		build[k] = v
	}
	build["name"] = name
	c.snap.Build = build
	c.info.Name = name
	return c
}
