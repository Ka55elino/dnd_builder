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

// buildHead holds the build fields that are duplicated into table columns.
type buildHead struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Level        int     `json:"level"`
	RaceID       *string `json:"raceId"`
	ClassID      *string `json:"classId"`
	SubclassID   *string `json:"subclassId"`
	BackgroundID *string `json:"backgroundId"`
	Portrait     *string `json:"portrait"`
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
	if b.ClassID == nil || *b.ClassID == "" {
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
func saveCharacter(db execer, buildJSON string) (string, error) {
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
	if head.Level < 1 {
		head.Level = 1
	}

	_, err := db.Exec(Q("UpsertCharacter"),
		head.ID, strings.TrimSpace(head.Name), head.Level,
		head.ClassID, head.SubclassID, head.RaceID, head.BackgroundID, head.Portrait,
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
