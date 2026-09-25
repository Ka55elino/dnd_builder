package main

import (
	"bytes"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"
)

// Reference data (JSON) embedded into the binary.
// Layout: db/data/<table>/... with any nested folders, *.json files.
//
//go:embed all:db/data
var dataFS embed.FS

// seeder fills one table from a folder of JSON files if the table is empty.
type seeder struct {
	table string                             // for logging
	dir   string                             // folder in dataFS
	match func(path string) bool             // which files to take (nil: all *.json)
	count string                             // name of the COUNT(*) query
	row   func(tx *sql.Tx, raw []byte) error // inserts one file
	dev   bool                               // dev mode only (wails dev)
}

// Order matters: classes before subclasses (class_id foreign key).
var seeders = []seeder{
	{table: "races", dir: "db/data/races", count: "CountRaces", row: insertRaceJSON},
	{table: "classes", dir: "db/data/classes", match: notInSubclasses, count: "CountClasses", row: insertClassJSON},
	{table: "subclasses", dir: "db/data/classes", match: inSubclasses, count: "CountSubclasses", row: insertSubclassJSON},

	// equipment: items before packs (pack_items references both)
	{table: "weapons", dir: "db/data/weapons", count: "CountWeapons", row: insertWeaponJSON},
	{table: "armor", dir: "db/data/armor", count: "CountArmor", row: insertArmorJSON},
	{table: "items", dir: "db/data/items", count: "CountItems", row: insertItemJSON},
	{table: "packs", dir: "db/data/packs", count: "CountPacks", row: insertPackJSON},

	// rules: backgrounds, feats, spells and abilities
	{table: "backgrounds", dir: "db/data/backgrounds", count: "CountBackgrounds", row: insertBackgroundJSON},
	{table: "feats", dir: "db/data/feats", count: "CountFeats", row: insertFeatJSON},
	{table: "spells", dir: "db/data/spells", count: "CountSpells", row: insertSpellJSON},

	// sample characters: dev mode only, and only if there are no characters yet
	{table: "characters", dir: "db/data/characters", count: "CountCharacters", row: insertCharacterJSON, dev: true},
}

func inSubclasses(path string) bool    { return strings.Contains(path, "/subclasses/") }
func notInSubclasses(path string) bool { return !inSubclasses(path) }

// seedAll is called on application startup.
func seedAll(db *sql.DB) error {
	for _, s := range seeders {
		if s.dev && !devMode {
			continue
		}
		if err := s.run(db); err != nil {
			return fmt.Errorf("seed %s: %w", s.table, err)
		}
	}
	return nil
}

func (s seeder) run(db *sql.DB) error {
	var n int
	if err := db.QueryRow(Q(s.count)).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil // table is already populated; leave it alone
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	err = fs.WalkDir(dataFS, s.dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".json") {
			return err
		}
		if s.match != nil && !s.match(path) {
			return nil
		}
		raw, err := dataFS.ReadFile(path)
		if err != nil {
			return err
		}
		if err := s.row(tx, raw); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		return nil
	})
	if err != nil {
		return err
	}

	return tx.Commit()
}

// insertRaceJSON inserts a race or subrace. A subrace has a "race" field (the parent id).
func insertRaceJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		ID    string  `json:"id"`
		Name  string  `json:"name"`
		Race  *string `json:"race"`
		Image *string `json:"image"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if head.ID == "" || head.Name == "" {
		return fmt.Errorf("missing id or name")
	}

	// image is stored in its own column, so remove it from data_json.
	data, err := withoutKeys(raw, "image")
	if err != nil {
		return err
	}

	_, err = tx.Exec(Q("InsertRace"), head.ID, head.Name, head.Race, head.Image, data)
	return err
}

// insertClassJSON inserts a class: scalar fields go into columns, the rest into data_json.
func insertClassJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		ID            string  `json:"id"`
		Name          string  `json:"name"`
		Image         *string `json:"image"`
		HitDie        *int    `json:"hitDie"`
		Caster        *string `json:"caster"`
		SubclassLevel *int    `json:"subclassLevel"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if head.ID == "" || head.Name == "" {
		return fmt.Errorf("missing id or name")
	}

	data, err := withoutKeys(raw, "image")
	if err != nil {
		return err
	}

	_, err = tx.Exec(Q("InsertClass"),
		head.ID, head.Name, head.Image, head.HitDie, head.Caster, head.SubclassLevel, data)
	return err
}

// insertSubclassJSON inserts a subclass. The "class" field is the parent class id.
func insertSubclassJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		ID    string  `json:"id"`
		Name  string  `json:"name"`
		Class string  `json:"class"`
		Image *string `json:"image"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if head.ID == "" || head.Name == "" || head.Class == "" {
		return fmt.Errorf("missing id, name or class")
	}

	data, err := withoutKeys(raw, "image")
	if err != nil {
		return err
	}

	_, err = tx.Exec(Q("InsertSubclass"), head.ID, head.Class, head.Name, head.Image, data)
	return err
}

// ---------- equipment ----------

// Common fields of all equipment reference tables.
type equipHead struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Image     *string `json:"image"`
	IsDefault bool    `json:"isDefault"`
}

func (h equipHead) validate() error {
	if h.ID == "" || h.Name == "" {
		return fmt.Errorf("missing id or name")
	}
	return nil
}

func insertWeaponJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		equipHead
		Category   string  `json:"category"`
		Damage     *string `json:"damage"`
		DamageType *string `json:"damageType"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if err := head.validate(); err != nil {
		return err
	}
	data, err := withoutKeys(raw, "image", "isDefault")
	if err != nil {
		return err
	}
	_, err = tx.Exec(Q("InsertWeapon"), head.ID, head.Name, head.Image,
		head.Category, head.Damage, head.DamageType, head.IsDefault, data)
	return err
}

func insertArmorJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		equipHead
		Category string `json:"category"`
		BaseAC   *int   `json:"baseAC"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if err := head.validate(); err != nil {
		return err
	}
	data, err := withoutKeys(raw, "image", "isDefault")
	if err != nil {
		return err
	}
	_, err = tx.Exec(Q("InsertArmor"), head.ID, head.Name, head.Image,
		head.Category, head.BaseAC, head.IsDefault, data)
	return err
}

func insertItemJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		equipHead
		Weight *float64 `json:"weight"`
		Cost   *string  `json:"cost"`
		Desc   *string  `json:"desc"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if err := head.validate(); err != nil {
		return err
	}
	data, err := withoutKeys(raw, "image", "isDefault", "weight", "cost", "desc")
	if err != nil {
		return err
	}
	_, err = tx.Exec(Q("InsertItem"), head.ID, head.Name, head.Image,
		head.Weight, head.Cost, head.Desc, head.IsDefault, data)
	return err
}

// insertPackJSON inserts a pack and its rows in pack_items.
// JSON: "items": [{ "id": "rope", "qty": 1 }, ...]
func insertPackJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		equipHead
		Cost  *string `json:"cost"`
		Desc  *string `json:"desc"`
		Items []struct {
			ID  string `json:"id"`
			Qty int    `json:"qty"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if err := head.validate(); err != nil {
		return err
	}
	data, err := withoutKeys(raw, "image", "isDefault", "cost", "desc", "items")
	if err != nil {
		return err
	}
	if _, err := tx.Exec(Q("InsertPack"), head.ID, head.Name, head.Image,
		head.Cost, head.Desc, head.IsDefault, data); err != nil {
		return err
	}
	for _, it := range head.Items {
		qty := it.Qty
		if qty <= 0 {
			qty = 1
		}
		if _, err := tx.Exec(Q("InsertPackItem"), head.ID, it.ID, qty); err != nil {
			return fmt.Errorf("pack item %q: %w", it.ID, err)
		}
	}
	return nil
}

// withoutKeys returns the object's compact JSON without the given keys.
func withoutKeys(raw []byte, keys ...string) (string, error) {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return "", err
	}
	for _, k := range keys {
		delete(obj, k)
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return "", err
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, b); err != nil {
		return "", err
	}
	return compact.String(), nil
}
