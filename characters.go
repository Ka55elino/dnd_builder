package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// CharacterSummary — строка для списка персонажей (стартовая страница).
type CharacterSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Level     int    `json:"level"`
	RaceID    string `json:"raceId"`
	ClassID   string `json:"classId"`
	ClassName string `json:"className"`
	Portrait  string `json:"portrait"`
	UpdatedAt int64  `json:"updatedAt"` // unix-время
}

// buildHead — поля build, которые дублируются в колонки таблицы.
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

// validate — минимальная серверная проверка (полная — на фронтенде).
func (b buildHead) validate() error {
	var missing []string
	if strings.TrimSpace(b.ID) == "" {
		missing = append(missing, "id")
	}
	if strings.TrimSpace(b.Name) == "" {
		missing = append(missing, "имя")
	}
	if b.RaceID == nil || *b.RaceID == "" {
		missing = append(missing, "раса")
	}
	if b.ClassID == nil || *b.ClassID == "" {
		missing = append(missing, "класс")
	}
	if len(missing) > 0 {
		return fmt.Errorf("не заполнено: %s", strings.Join(missing, ", "))
	}
	return nil
}

// execer — *sql.DB или *sql.Tx.
type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

// insertCharacterJSON — сид: пример персонажа из db/data/characters.
func insertCharacterJSON(tx *sql.Tx, raw []byte) error {
	_, err := saveCharacter(tx, string(raw))
	return err
}

// saveCharacter сохраняет build (JSON объекта CharacterBuild) и возвращает id.
func saveCharacter(db execer, buildJSON string) (string, error) {
	var head buildHead
	if err := json.Unmarshal([]byte(buildJSON), &head); err != nil {
		return "", fmt.Errorf("некорректный JSON персонажа: %w", err)
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

// getCharacter возвращает сохранённый build как объект.
func getCharacter(db *sql.DB, id string) (map[string]any, error) {
	var raw string
	err := db.QueryRow(Q("GetCharacter"), id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("персонаж %q не найден", id)
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

// getCharacterState — игровое состояние персонажа (nil, если ещё не сохранялось).
func getCharacterState(db *sql.DB, id string) (map[string]any, error) {
	var raw sql.NullString
	err := db.QueryRow(Q("GetCharacterState"), id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("персонаж %q не найден", id)
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

// saveCharacterState — сохранить игровое состояние (JSON CharacterState).
func saveCharacterState(db *sql.DB, id, stateJSON string) error {
	if !json.Valid([]byte(stateJSON)) {
		return fmt.Errorf("некорректный JSON состояния")
	}
	res, err := db.Exec(Q("SaveCharacterState"), stateJSON, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("персонаж %q не найден", id)
	}
	return nil
}
