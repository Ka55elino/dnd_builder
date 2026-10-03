package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// Wild Shape forms (db/schema/wild_shape.sql): the link "class / subclass → bestiary monster,
// from level N". The forms a druid knows are chosen in the builder (rules/progression.js);
// the stat block comes from the bestiary.

// WildShapeForm is one link.
type WildShapeForm struct {
	MonsterID  string `json:"monsterId"`
	ClassID    string `json:"classId"`
	SubclassID string `json:"subclassId"` // "" — every subclass
	MinLevel   int    `json:"minLevel"`
	Sort       int    `json:"sort"`
	IsCustom   bool   `json:"isCustom"`
	// the monster, in short (lists): the stat block itself comes from the bestiary
	Name  string         `json:"name"`
	Type  string         `json:"type"`
	Size  string         `json:"size"`
	CR    float64        `json:"cr"`
	AC    int            `json:"ac"`
	HP    int            `json:"hp"`
	Image string         `json:"image"`
	Speed map[string]any `json:"speed"` // { walk, fly, swim, climb, burrow }
}

func getWildShapeForms(db *sql.DB) ([]WildShapeForm, error) {
	rows, err := db.Query(Q("GetWildShapeForms"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WildShapeForm{}
	for rows.Next() {
		var f WildShapeForm
		var custom int
		var speed string
		if err := rows.Scan(&f.MonsterID, &f.ClassID, &f.SubclassID, &f.MinLevel, &f.Sort, &custom,
			&f.Name, &f.Type, &f.Size, &f.CR, &f.AC, &f.HP, &f.Image, &speed); err != nil {
			return nil, err
		}
		f.IsCustom = custom == 1
		f.Speed = map[string]any{}
		_ = json.Unmarshal([]byte(speed), &f.Speed)
		out = append(out, f)
	}
	return out, rows.Err()
}

// insertWildShapeJSON seeds a file of forms: [{ "monster", "class", "subclass"?, "minLevel" }].
// Monsters are seeded before (seed.go): a form of a missing monster is an error in the data.
func insertWildShapeJSON(tx *sql.Tx, raw []byte) error {
	var list []struct {
		Monster  string `json:"monster"`
		Class    string `json:"class"`
		Subclass string `json:"subclass"`
		MinLevel int    `json:"minLevel"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		return err
	}
	for i, f := range list {
		f.Monster, f.Class = strings.TrimSpace(f.Monster), strings.TrimSpace(f.Class)
		if f.Monster == "" || f.Class == "" {
			return fmt.Errorf("form %d: monster and class are required", i+1)
		}
		var n int
		if err := tx.QueryRow(Q("MonsterExists"), f.Monster).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return fmt.Errorf("form %d: no monster %q in the bestiary", i+1, f.Monster)
		}
		if f.MinLevel < 1 {
			f.MinLevel = 2
		}
		if _, err := tx.Exec(Q("InsertWildShapeForm"), f.Monster, f.Class, f.Subclass, f.MinLevel, i); err != nil {
			return err
		}
	}
	return nil
}

// GetWildShapeForms returns every Wild Shape form (which monster, for which class / subclass,
// from which level).
func (a *App) GetWildShapeForms() ([]WildShapeForm, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getWildShapeForms(db)
}
