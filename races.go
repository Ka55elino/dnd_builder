package main

import (
	"database/sql"
	"encoding/json"
)

// Race is a race or subrace for the frontend.
// Data is the raw JSON from data_json (size, speed, traits, subraceLevel...).
type Race struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	ParentRace string         `json:"parentRace,omitempty"`
	Image      string         `json:"image"` // data URL (base64) or ""
	IsCustom   bool           `json:"isCustom"`
	Data       map[string]any `json:"data"`
	Subraces   []Race         `json:"subraces"`
}

// getAllRaces returns the base races, each with its subraces nested.
func getAllRaces(db *sql.DB) ([]Race, error) {
	rows, err := db.Query(Q("GetAllRaces"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var (
		bases []Race
		subs  []Race
	)

	for rows.Next() {
		var (
			r        Race
			parent   sql.NullString
			image    sql.NullString
			dataJSON string
		)
		if err := rows.Scan(&r.ID, &r.Name, &parent, &image, &dataJSON, &r.IsCustom); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(dataJSON), &r.Data); err != nil {
			return nil, err
		}
		r.Image = image.String
		r.Subraces = []Race{}

		if parent.Valid {
			r.ParentRace = parent.String
			subs = append(subs, r)
		} else {
			bases = append(bases, r)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	index := make(map[string]int, len(bases))
	for i, b := range bases {
		index[b.ID] = i
	}
	for _, s := range subs {
		if i, ok := index[s.ParentRace]; ok {
			bases[i].Subraces = append(bases[i].Subraces, s)
		}
	}

	if bases == nil {
		bases = []Race{}
	}
	return bases, nil
}
