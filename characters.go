package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// CharacterSummary is a row in the character list (start page).
type CharacterSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Level     int    `json:"level"`
	RaceID    string `json:"raceId"`
	ClassID   string `json:"classId"`
	ClassName string `json:"className"`
	Portrait  string `json:"portrait"`
	UpdatedAt int64  `json:"updatedAt"` // unix time
}

// buildClass is one entry of build.classes (multiclassing).
type buildClass struct {
	ClassID    string  `json:"classId"`
	SubclassID *string `json:"subclassId"`
}

// buildHead holds the build fields that are duplicated into table columns.
// Classes: classes[0] is the primary class; the character level is the number
// of entries in levelClasses (the class gained at each level).
type buildHead struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	RaceID       *string      `json:"raceId"`
	Classes      []buildClass `json:"classes"`
	LevelClasses []*string    `json:"levelClasses"`
	BackgroundID *string      `json:"backgroundId"`
	Portrait     *string      `json:"portrait"`
}

// level is the character level (total of class levels).
func (b buildHead) level() int {
	if n := len(b.LevelClasses); n > 0 {
		return n
	}
	return 1
}

// primary returns the primary class and subclass ids (nil if there is no class).
func (b buildHead) primary() (classID, subclassID *string) {
	if len(b.Classes) == 0 || b.Classes[0].ClassID == "" {
		return nil, nil
	}
	return &b.Classes[0].ClassID, b.Classes[0].SubclassID
}

// classSummary is the class line for the character list: "Fighter 3 / Wizard 2".
// A single class — "" (the list shows the class name from the classes table).
func (b buildHead) classSummary(db querier) string {
	counts := map[string]int{}
	for _, id := range b.LevelClasses {
		if id != nil && *id != "" {
			counts[*id]++
		}
	}
	var parts []string
	for _, c := range b.Classes {
		n := counts[c.ClassID]
		if n == 0 {
			continue
		}
		name := c.ClassID
		var dbName string
		if err := db.QueryRow(Q("GetClassName"), c.ClassID).Scan(&dbName); err == nil && dbName != "" {
			name = dbName
		}
		parts = append(parts, fmt.Sprintf("%s %d", name, n))
	}
	if len(parts) < 2 {
		return ""
	}
	return strings.Join(parts, " / ")
}

// validate performs minimal server-side validation (full validation is on the frontend).
func (b buildHead) validate() error {
	var missing []string
	if strings.TrimSpace(b.ID) == "" {
		missing = append(missing, "id")
	}
	if strings.TrimSpace(b.Name) == "" {
		missing = append(missing, "name")
	}
	if b.RaceID == nil || *b.RaceID == "" {
		missing = append(missing, "race")
	}
	if cls, _ := b.primary(); cls == nil {
		missing = append(missing, "class")
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required fields: %s", strings.Join(missing, ", "))
	}
	return nil
}

// execer is either *sql.DB or *sql.Tx.
type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

// insertCharacterJSON seeds a sample character from assets/data/characters.
func insertCharacterJSON(tx *sql.Tx, raw []byte) error {
	raw, err := withRacePortrait(tx, raw)
	if err != nil {
		return err
	}
	_, err = saveCharacter(tx, string(raw))
	return err
}

// withRacePortrait sets the portrait of seeded characters from the subrace image
// (if it has one), otherwise from the race image. A custom portrait in the seed
// (not the SVG placeholder) is left untouched. Races are seeded before characters
// (see the order in seeders).
func withRacePortrait(tx *sql.Tx, raw []byte) ([]byte, error) {
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil, err
	}
	if p, _ := obj["portrait"].(string); p != "" && !isPlaceholderPortrait(p) {
		return raw, nil
	}
	for _, key := range []string{"subraceId", "raceId"} {
		id, _ := obj[key].(string)
		if id == "" {
			continue
		}
		var img string
		err := tx.QueryRow(Q("GetRaceImage"), id).Scan(&img)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if img != "" {
			obj["portrait"] = img
			return json.Marshal(obj)
		}
	}
	return raw, nil
}

// isPlaceholderPortrait: the SVG silhouette from the seeds ("/img/characters/….svg" or an SVG data URL).
func isPlaceholderPortrait(p string) bool {
	return strings.HasSuffix(p, ".svg") || strings.HasPrefix(p, "data:image/svg+xml")
}

// saveCharacter saves a build (CharacterBuild object JSON) and returns its id.
func saveCharacter(db querier, buildJSON string) (string, error) {
	// an uploaded portrait (data URL) goes to the images table, the build keeps its /img/db/ URL
	if strings.Contains(buildJSON, `"portrait":"data:`) || strings.Contains(buildJSON, `"portrait": "data:`) {
		var obj map[string]any
		if err := json.Unmarshal([]byte(buildJSON), &obj); err != nil {
			return "", fmt.Errorf("invalid character JSON: %w", err)
		}
		if err := storeImageField(db, obj, "portrait"); err != nil {
			return "", err
		}
		b, err := json.Marshal(obj)
		if err != nil {
			return "", err
		}
		buildJSON = string(b)
	}
	var head buildHead
	if err := json.Unmarshal([]byte(buildJSON), &head); err != nil {
		return "", fmt.Errorf("invalid character JSON: %w", err)
	}
	if err := head.validate(); err != nil {
		return "", err
	}
	classID, subclassID := head.primary()

	_, err := db.Exec(Q("UpsertCharacter"),
		head.ID, strings.TrimSpace(head.Name), head.level(),
		classID, subclassID, head.classSummary(db), head.RaceID, head.BackgroundID, head.Portrait,
		buildJSON)
	if err != nil {
		return "", err
	}
	return head.ID, nil
}

// getCharacter returns a saved build as an object.
func getCharacter(db *sql.DB, id string) (map[string]any, error) {
	var raw string
	err := db.QueryRow(Q("GetCharacter"), id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("character %q not found", id)
	}
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func listCharacters(db *sql.DB) ([]CharacterSummary, error) {
	rows, err := db.Query(Q("ListCharacters"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []CharacterSummary{}
	for rows.Next() {
		var (
			c                     CharacterSummary
			race, class, portrait sql.NullString
		)
		if err := rows.Scan(&c.ID, &c.Name, &c.Level, &race, &class, &c.ClassName, &portrait, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.RaceID, c.ClassID, c.Portrait = race.String, class.String, portrait.String
		out = append(out, c)
	}
	return out, rows.Err()
}

// getCharacterState returns the character's play state (nil if it has not been saved yet).
func getCharacterState(db *sql.DB, id string) (map[string]any, error) {
	var raw sql.NullString
	err := db.QueryRow(Q("GetCharacterState"), id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("character %q not found", id)
	}
	if err != nil || !raw.Valid || raw.String == "" {
		return nil, err
	}
	out := map[string]any{}
	if err := json.Unmarshal([]byte(raw.String), &out); err != nil {
		return nil, err
	}
	return out, nil
}

// saveCharacterState saves the play state (CharacterState JSON).
func saveCharacterState(db *sql.DB, id, stateJSON string) error {
	if !json.Valid([]byte(stateJSON)) {
		return fmt.Errorf("invalid state JSON")
	}
	res, err := db.Exec(Q("SaveCharacterState"), stateJSON, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("character %q not found", id)
	}
	return nil
}

// deleteCharacter deletes a character with its play state (the same row) and its campaign
// links; an uploaded portrait no other record uses goes too (deleteOrphanImages).
func deleteCharacter(db *sql.DB, id string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(Q("DeleteCharacterLinks"), id, id); err != nil {
		return err
	}
	res, err := tx.Exec(Q("DeleteCharacter"), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("character %q not found", id)
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	deleteOrphanImages(db)
	return nil
}
