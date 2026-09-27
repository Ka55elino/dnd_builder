package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// Bestiary: monsters (reference data + the DM's own) and encounter presets.
// The app is a companion to the table, not a replacement: stat blocks are
// shown for reading and counting, nothing is rolled.

// Monster is a bestiary entry. Data holds the stat block:
// speed, abilities, saves, skills, defenses, senses, languages, traits,
// actions, bonusActions, reactions, legendary, desc… (see assets/data/monsters/README.md).
type Monster struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Image     string         `json:"image"`
	Type      string         `json:"type"`
	Size      string         `json:"size"`
	Alignment string         `json:"alignment"`
	CR        float64        `json:"cr"`
	XP        int            `json:"xp"`
	AC        int            `json:"ac"`
	HP        int            `json:"hp"`
	Legendary bool           `json:"legendary"`
	Habitats  []string       `json:"habitats"`
	Data      map[string]any `json:"data"`
}

// EncounterMonster is one line of an encounter preset.
type EncounterMonster struct {
	MonsterID string `json:"monsterId"`
	Count     int    `json:"count"`
}

// Encounter is a preset: a named group of monsters with the DM's notes.
type Encounter struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	Notes     string             `json:"notes"`
	Monsters  []EncounterMonster `json:"monsters"`
	UpdatedAt int64              `json:"updatedAt"`
}

// creature types, sizes (validation of seeds and custom monsters)
var (
	monsterTypes = set("aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey",
		"fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead")
	monsterSizes = set("tiny", "small", "medium", "large", "huge", "gargantuan")
)

func set(xs ...string) map[string]bool {
	m := make(map[string]bool, len(xs))
	for _, x := range xs {
		m[x] = true
	}
	return m
}

// xpByCR is the XP a monster is worth by Challenge Rating.
var xpByCR = map[float64]int{
	0: 10, 0.125: 25, 0.25: 50, 0.5: 100,
	1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
	11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000,
	19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000,
	27: 105000, 28: 120000, 29: 135000, 30: 155000,
}

// ---------- reading ----------

func getMonsters(db *sql.DB) ([]Monster, error) {
	rows, err := db.Query(Q("GetAllMonsters"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Monster{}
	for rows.Next() {
		var (
			m                Monster
			image, alignment sql.NullString
			habitats, data   string
		)
		if err := rows.Scan(&m.ID, &m.Name, &image, &m.Type, &m.Size, &alignment, &m.CR, &m.XP,
			&m.AC, &m.HP, &m.Legendary, &habitats, &data); err != nil {
			return nil, err
		}
		m.Image, m.Alignment = image.String, alignment.String
		m.Habitats = []string{}
		_ = json.Unmarshal([]byte(habitats), &m.Habitats)
		if m.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func getEncounters(db *sql.DB) ([]Encounter, error) {
	rows, err := db.Query(Q("GetAllEncounters"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Encounter{}
	for rows.Next() {
		var (
			e    Encounter
			list string
		)
		if err := rows.Scan(&e.ID, &e.Name, &e.Notes, &list, &e.UpdatedAt); err != nil {
			return nil, err
		}
		e.Monsters = []EncounterMonster{}
		_ = json.Unmarshal([]byte(list), &e.Monsters)
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---------- writing ----------

// insertMonsterJSON inserts a monster (seeds and custom monsters, see customKinds).
// The list columns are taken out of the JSON; everything else goes to data_json.
func insertMonsterJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		ID        string   `json:"id"`
		Name      string   `json:"name"`
		Image     *string  `json:"image"`
		Type      string   `json:"type"`
		Size      string   `json:"size"`
		Alignment *string  `json:"alignment"`
		CR        *float64 `json:"cr"`
		XP        *int     `json:"xp"`
		AC        int      `json:"ac"`
		HP        int      `json:"hp"`
		Habitats  []string `json:"habitats"`
		Legendary *struct {
			Actions []json.RawMessage `json:"actions"`
		} `json:"legendary"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	head.Type, head.Size = strings.ToLower(head.Type), strings.ToLower(head.Size)
	var missing []string
	if strings.TrimSpace(head.ID) == "" {
		missing = append(missing, "id")
	}
	if strings.TrimSpace(head.Name) == "" {
		missing = append(missing, "name")
	}
	if head.CR == nil {
		missing = append(missing, "cr")
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing: %s", strings.Join(missing, ", "))
	}
	if !monsterTypes[head.Type] {
		return fmt.Errorf("unknown creature type %q", head.Type)
	}
	if !monsterSizes[head.Size] {
		return fmt.Errorf("unknown size %q", head.Size)
	}
	if *head.CR < 0 || *head.CR > 30 {
		return fmt.Errorf("challenge rating must be 0–30, got %v", *head.CR)
	}
	xp := 0
	if head.XP != nil {
		xp = *head.XP
	} else if v, ok := xpByCR[*head.CR]; ok {
		xp = v
	}
	if head.Habitats == nil {
		head.Habitats = []string{}
	}
	habitats, _ := json.Marshal(head.Habitats)
	legendary := head.Legendary != nil && len(head.Legendary.Actions) > 0

	data, err := withoutKeys(raw, "id", "name", "image", "type", "size", "alignment",
		"cr", "xp", "ac", "hp", "habitats")
	if err != nil {
		return err
	}
	_, err = tx.Exec(Q("InsertMonster"), head.ID, head.Name, head.Image, head.Type, head.Size,
		head.Alignment, *head.CR, xp, head.AC, head.HP, legendary, string(habitats), data)
	return err
}

// saveEncounter creates or updates a preset and returns its id.
func saveEncounter(db *sql.DB, raw string) (string, error) {
	var e Encounter
	if err := json.Unmarshal([]byte(raw), &e); err != nil {
		return "", err
	}
	e.Name = strings.TrimSpace(e.Name)
	if e.Name == "" {
		return "", fmt.Errorf("enter an encounter name")
	}
	if e.ID == "" {
		e.ID = "enc_" + strings.TrimPrefix(newCustomID(), "custom_")
	}
	// drop empty lines, merge duplicates, keep the order
	list := []EncounterMonster{}
	index := map[string]int{}
	for _, m := range e.Monsters {
		if m.MonsterID == "" || m.Count <= 0 {
			continue
		}
		if i, ok := index[m.MonsterID]; ok {
			list[i].Count += m.Count
			continue
		}
		index[m.MonsterID] = len(list)
		list = append(list, m)
	}
	b, err := json.Marshal(list)
	if err != nil {
		return "", err
	}
	if _, err := db.Exec(Q("UpsertEncounter"), e.ID, e.Name, e.Notes, string(b)); err != nil {
		return "", err
	}
	return e.ID, nil
}

// ---------- bound methods ----------

// GetMonsters returns the whole bestiary (built-in and custom monsters).
func (a *App) GetMonsters() ([]Monster, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getMonsters(db)
}

// SaveCustomMonster creates or updates the DM's own monster (built-in ones
// cannot be changed — copy them instead). Returns the id.
func (a *App) SaveCustomMonster(monsterJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	return saveCustomRecord(db, "monster", monsterJSON)
}

// DeleteCustomMonster deletes the DM's own monster.
func (a *App) DeleteCustomMonster(id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	return deleteCustomRecord(db, "monster", id)
}

// GetEncounters returns the encounter presets, most recently changed first.
func (a *App) GetEncounters() ([]Encounter, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getEncounters(db)
}

// SaveEncounter creates or updates an encounter preset. Returns the id.
func (a *App) SaveEncounter(encounterJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	return saveEncounter(db, encounterJSON)
}

// DeleteEncounter deletes an encounter preset.
func (a *App) DeleteEncounter(id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(Q("DeleteEncounter"), id)
	return err
}
