package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// Background is a background (2024 origin): ability score increases, skills, feat.
type Background struct {
	ID   string         `json:"id"`
	Name string         `json:"name"`
	Feat string         `json:"feat"` // origin feat id
	Data map[string]any `json:"data"` // abilities.options, skills, tool
}

// Feat is a feat or an "option": category = origin | general | boon | fightingStyle | metamagic | invocation.
type Feat struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Category string         `json:"category"`
	Level    int            `json:"level"`
	Desc     string         `json:"desc"`
	Data     map[string]any `json:"data"` // asi, effects, prereq...
}

// Condition is a condition (Prone, Grappled, Exhaustion…) or a named effect (Slowed, Enlarged):
// category = condition | effect. Data holds modifiers, implies, levels (see frontend rules/modifiers.js).
type Condition struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Category string         `json:"category"`
	Desc     string         `json:"desc"`
	Data     map[string]any `json:"data"`
}

// Spell is a spell or an ability: kind = spell | class | martial | action.
type Spell struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Kind          string         `json:"kind"`
	Level         int            `json:"level"` // spell level (0 = cantrip) or the level at which the ability is gained
	School        string         `json:"school"`
	Action        string         `json:"action"`
	Concentration bool           `json:"concentration"`
	Ritual        bool           `json:"ritual"`
	Desc          string         `json:"desc"`
	Data          map[string]any `json:"data"` // classes, subclass, uses, damage, casting...
}

// ---------- reading ----------

func getBackgrounds(db *sql.DB) ([]Background, error) {
	rows, err := db.Query(Q("GetAllBackgrounds"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Background{}
	for rows.Next() {
		var (
			b    Background
			feat sql.NullString
			data string
		)
		if err := rows.Scan(&b.ID, &b.Name, &feat, &data); err != nil {
			return nil, err
		}
		if b.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		b.Feat = feat.String
		out = append(out, b)
	}
	return out, rows.Err()
}

func getFeats(db *sql.DB) ([]Feat, error) {
	rows, err := db.Query(Q("GetAllFeats"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Feat{}
	for rows.Next() {
		var (
			f         Feat
			cat, desc sql.NullString
			level     sql.NullInt64
			data      string
		)
		if err := rows.Scan(&f.ID, &f.Name, &cat, &level, &desc, &data); err != nil {
			return nil, err
		}
		if f.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		f.Category, f.Level, f.Desc = cat.String, int(level.Int64), desc.String
		out = append(out, f)
	}
	return out, rows.Err()
}

func getConditions(db *sql.DB) ([]Condition, error) {
	rows, err := db.Query(Q("GetAllConditions"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Condition{}
	for rows.Next() {
		var (
			c    Condition
			desc sql.NullString
			data string
		)
		if err := rows.Scan(&c.ID, &c.Name, &c.Category, &desc, &data); err != nil {
			return nil, err
		}
		if c.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		c.Desc = desc.String
		out = append(out, c)
	}
	return out, rows.Err()
}

func insertConditionJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		ID       string  `json:"id"`
		Name     string  `json:"name"`
		Category *string `json:"category"`
		Desc     *string `json:"desc"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if head.ID == "" || head.Name == "" {
		return fmt.Errorf("missing id or name")
	}
	cat := "condition"
	if head.Category != nil && *head.Category != "" {
		cat = *head.Category
	}
	data, err := withoutKeys(raw, "desc")
	if err != nil {
		return err
	}
	_, err = tx.Exec(Q("InsertCondition"), head.ID, head.Name, cat, head.Desc, data)
	return err
}

func getSpells(db *sql.DB) ([]Spell, error) {
	rows, err := db.Query(Q("GetAllSpells"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Spell{}
	for rows.Next() {
		var (
			s                    Spell
			school, action, desc sql.NullString
			data                 string
		)
		if err := rows.Scan(&s.ID, &s.Name, &s.Kind, &s.Level, &school, &action,
			&s.Concentration, &s.Ritual, &desc, &data); err != nil {
			return nil, err
		}
		if s.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		s.School, s.Action, s.Desc = school.String, action.String, desc.String
		out = append(out, s)
	}
	return out, rows.Err()
}

// ---------- seeds ----------

func insertBackgroundJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		ID   string  `json:"id"`
		Name string  `json:"name"`
		Feat *string `json:"feat"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if head.ID == "" || head.Name == "" {
		return fmt.Errorf("missing id or name")
	}
	data, err := withoutKeys(raw)
	if err != nil {
		return err
	}
	_, err = tx.Exec(Q("InsertBackground"), head.ID, head.Name, head.Feat, data)
	return err
}

func insertFeatJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		ID       string  `json:"id"`
		Name     string  `json:"name"`
		Category *string `json:"category"`
		Level    *int    `json:"level"`
		Desc     *string `json:"desc"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if head.ID == "" || head.Name == "" {
		return fmt.Errorf("missing id or name")
	}
	data, err := withoutKeys(raw, "desc")
	if err != nil {
		return err
	}
	_, err = tx.Exec(Q("InsertFeat"), head.ID, head.Name, head.Category, head.Level, head.Desc, data)
	return err
}

func insertSpellJSON(tx *sql.Tx, raw []byte) error {
	var head struct {
		ID      string   `json:"id"`
		Name    string   `json:"name"`
		Kind    string   `json:"kind"`
		Level   int      `json:"level"`
		School  *string  `json:"school"`
		Action  *string  `json:"action"`
		Desc    *string  `json:"desc"`
		Classes []string `json:"classes"`
		Casting *struct {
			Concentration bool `json:"concentration"`
			Ritual        bool `json:"ritual"`
		} `json:"casting"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return err
	}
	if head.ID == "" || head.Name == "" {
		return fmt.Errorf("missing id or name")
	}
	if head.Kind == "" {
		head.Kind = "spell"
	}
	if head.Action != nil {
		a := strings.TrimSuffix(*head.Action, "_action") // bonus_action → bonus
		head.Action = &a
	}
	conc, ritual := false, false
	if head.Casting != nil {
		conc, ritual = head.Casting.Concentration, head.Casting.Ritual
	}
	data, err := withoutKeys(raw, "desc")
	if err != nil {
		return err
	}
	if _, err := tx.Exec(Q("InsertSpell"), head.ID, head.Name, head.Kind, head.Level,
		head.School, head.Action, conc, ritual, head.Desc, data); err != nil {
		return err
	}
	for _, c := range head.Classes {
		if _, err := tx.Exec(Q("InsertSpellClass"), head.ID, c); err != nil {
			return err
		}
	}
	return nil
}
