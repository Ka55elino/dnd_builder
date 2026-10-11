package main

import (
	"bytes"
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"strings"
)

// Reference data (JSON) embedded into the binary.
// Layout: assets/data/<table>/... with any nested folders, *.json files.
//
//go:embed all:assets/data
var dataFS embed.FS

// Reference data and app versions: the database is one file for every version (db.go), and
// app_meta.data_version says which version's built-in data it holds. When the app version is
// different, the built-in rows (is_custom = 0) of the reference tables are deleted and seeded
// again from this binary's JSON; the user's rows — characters, campaigns, custom spells /
// items / monsters / conditions… — are not touched. No migrations: a new column is added
// with ensureColumn (db.go), the reference data itself just comes again.

// builtinTables are the reference tables refreshed on a version change (all have is_custom).
var builtinTables = []string{
	"races", "classes", "subclasses",
	"weapons", "armor", "items", "packs",
	"backgrounds", "feats", "spells", "conditions",
	"monsters", "wild_shape_forms",
}

// clearBuiltins deletes the built-in rows of the reference tables (and their link rows).
// Foreign keys are off for it (on its own connection): a custom subclass of a built-in
// class, a custom pack with built-in items must not cascade away — the same ids come back
// right after with the new seed.
func clearBuiltins(db *sql.DB) error {
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys = OFF"); err != nil {
		return err
	}
	defer conn.ExecContext(ctx, "PRAGMA foreign_keys = ON") //nolint:errcheck

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmts := []string{
		"DELETE FROM pack_items WHERE pack_id IN (SELECT id FROM packs WHERE is_custom = 0)",
		"DELETE FROM spell_classes WHERE spell_id IN (SELECT id FROM spells WHERE is_custom = 0)",
	}
	for _, t := range builtinTables {
		stmts = append(stmts, "DELETE FROM "+t+" WHERE is_custom = 0")
	}
	for _, q := range stmts {
		if _, err := tx.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("%s: %w", q, err)
		}
	}
	return tx.Commit()
}

// seeder fills one table from a folder of JSON files if the table is empty
// (or always, when the built-in data is being refreshed).
type seeder struct {
	table string                             // for logging
	dir   string                             // folder in dataFS
	match func(path string) bool             // which files to take (nil: all *.json)
	count string                             // name of the COUNT(*) query
	row   func(tx *sql.Tx, raw []byte) error // inserts one file
	dev   bool                               // dev mode only (wails3 dev)
}

// Order matters: classes before subclasses (class_id foreign key).
var seeders = []seeder{
	{table: "races", dir: "assets/data/races", count: "CountRaces", row: insertRaceJSON},
	{table: "classes", dir: "assets/data/classes", match: notInSubclasses, count: "CountClasses", row: insertClassJSON},
	{table: "subclasses", dir: "assets/data/classes", match: inSubclasses, count: "CountSubclasses", row: insertSubclassJSON},

	// equipment: items before packs (pack_items references both)
	{table: "weapons", dir: "assets/data/weapons", count: "CountWeapons", row: insertWeaponJSON},
	{table: "armor", dir: "assets/data/armor", count: "CountArmor", row: insertArmorJSON},
	{table: "items", dir: "assets/data/items", count: "CountItems", row: insertItemJSON},
	{table: "packs", dir: "assets/data/packs", count: "CountPacks", row: insertPackJSON},

	// rules: backgrounds, feats, spells and abilities
	{table: "backgrounds", dir: "assets/data/backgrounds", count: "CountBackgrounds", row: insertBackgroundJSON},
	{table: "feats", dir: "assets/data/feats", count: "CountFeats", row: insertFeatJSON},
	{table: "spells", dir: "assets/data/spells", count: "CountSpells", row: insertSpellJSON},
	{table: "conditions", dir: "assets/data/conditions", count: "CountConditions", row: insertConditionJSON},

	// bestiary
	{table: "monsters", dir: "assets/data/monsters", count: "CountMonsters", row: insertMonsterJSON},

	// Wild Shape forms: the link class → bestiary monster (after the monsters)
	{table: "wild_shape_forms", dir: "assets/data/wildshape", count: "CountWildShapeForms", row: insertWildShapeJSON},

	// sample characters: dev mode only, and only if there are no characters yet
	{table: "characters", dir: "assets/data/characters", count: "CountCharacters", row: insertCharacterJSON, dev: true},

	// a sample campaign (locations, NPCs, encounters, links): dev mode only, if there are none
	{table: "campaigns", dir: "assets/data/campaigns", count: "CountCampaigns", row: insertCampaignJSON, dev: true},
}

func inSubclasses(path string) bool    { return strings.Contains(path, "/subclasses/") }
func notInSubclasses(path string) bool { return !inSubclasses(path) }

// seedAll is called on application startup. A database whose built-in data is from another
// app version gets it refreshed (a backup, clearBuiltins, seed again); the version is
// written only when everything went in, so a failed refresh is tried again next launch.
func seedAll(db *sql.DB) error {
	var have string
	if err := db.QueryRow(Q("GetMeta"), "data_version").Scan(&have); err != nil && err != sql.ErrNoRows {
		return err
	}
	refresh := have != APP_VERSION
	if refresh {
		// a copy of the user's data first (not fatal: the refresh doesn't touch user rows)
		if err := backupDB(db, have); err != nil {
			log.Printf("database: backup: %v", err)
		}
		if err := clearBuiltins(db); err != nil {
			return fmt.Errorf("refresh built-in data: %w", err)
		}
		if have != "" {
			log.Printf("database: built-in data %s → %s", have, APP_VERSION)
		}
	}
	for _, s := range seeders {
		if s.dev && !devMode {
			continue
		}
		// dev samples (characters, a campaign) only fill an empty table; never refreshed
		if err := s.run(db, refresh && !s.dev); err != nil {
			return fmt.Errorf("seed %s: %w", s.table, err)
		}
	}
	if _, err := db.Exec(Q("SetMeta"), "data_version", APP_VERSION); err != nil {
		return err
	}
	return nil
}

// run inserts the table's JSON files: into an empty table, or always when force (the
// built-in rows were just cleared).
func (s seeder) run(db *sql.DB, force bool) error {
	if !force {
		var n int
		if err := db.QueryRow(Q(s.count)).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			return nil // table is already populated; leave it alone
		}
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
