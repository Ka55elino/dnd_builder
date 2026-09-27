package main

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// namedItem is a named (magic) item from the seed data — what the DM can give.
type namedItem struct {
	Kind string // weapon | armor | item (as in the app's "give" event)
	ID   string
	Name string
}

// loadNamedItems reads assets/data/{weapons,armor,items} (the same files the
// app seeds its catalog from) and returns the items with "isDefault": false.
func loadNamedItems(root string) []namedItem {
	var out []namedItem
	for dir, kind := range map[string]string{"weapons": "weapon", "armor": "armor", "items": "item"} {
		_ = filepath.WalkDir(filepath.Join(root, dir), func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".json") {
				return nil
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				return nil
			}
			var x struct {
				ID        string `json:"id"`
				Name      string `json:"name"`
				IsDefault *bool  `json:"isDefault"`
			}
			if json.Unmarshal(raw, &x) == nil && x.ID != "" && x.IsDefault != nil && !*x.IsDefault {
				out = append(out, namedItem{Kind: kind, ID: x.ID, Name: x.Name})
			}
			return nil
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// findItem matches an item by id or by (part of) its name, case-insensitive.
func findItem(items []namedItem, q string) (namedItem, bool) {
	q = strings.ToLower(strings.TrimSpace(q))
	for _, it := range items {
		if strings.ToLower(it.ID) == q {
			return it, true
		}
	}
	for _, it := range items {
		if strings.Contains(strings.ToLower(it.Name), q) {
			return it, true
		}
	}
	return namedItem{}, false
}
