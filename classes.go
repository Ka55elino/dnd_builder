package main

import (
	"database/sql"
	"encoding/json"
)

// Class — класс персонажа для фронтенда.
// Data — исходный JSON из data_json (primaryAbility, savingThrows, skills, features...).
type Class struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Image         string         `json:"image"` // data URL (base64) или ""
	HitDie        int            `json:"hitDie"`
	Caster        string         `json:"caster"` // full | half | third | none
	SubclassLevel int            `json:"subclassLevel"`
	IsCustom      bool           `json:"isCustom"`
	Data          map[string]any `json:"data"`
	Subclasses    []Subclass     `json:"subclasses"`
}

// Subclass — подкласс, привязан к классу через ClassID.
type Subclass struct {
	ID       string         `json:"id"`
	ClassID  string         `json:"classId"`
	Name     string         `json:"name"`
	Image    string         `json:"image"`
	IsCustom bool           `json:"isCustom"`
	Data     map[string]any `json:"data"`
}

// getAllClasses — все классы, у каждого вложены его подклассы.
func getAllClasses(db *sql.DB) ([]Class, error) {
	classes, err := queryClasses(db)
	if err != nil {
		return nil, err
	}
	subs, err := querySubclasses(db)
	if err != nil {
		return nil, err
	}

	index := make(map[string]int, len(classes))
	for i, c := range classes {
		index[c.ID] = i
	}
	for _, s := range subs {
		if i, ok := index[s.ClassID]; ok {
			classes[i].Subclasses = append(classes[i].Subclasses, s)
		}
	}
	return classes, nil
}

func queryClasses(db *sql.DB) ([]Class, error) {
	rows, err := db.Query(Q("GetAllClasses"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Class{}
	for rows.Next() {
		var (
			c             Class
			image, caster sql.NullString
			hitDie, subLv sql.NullInt64
			dataJSON      string
		)
		if err := rows.Scan(&c.ID, &c.Name, &image, &hitDie, &caster, &subLv, &dataJSON, &c.IsCustom); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(dataJSON), &c.Data); err != nil {
			return nil, err
		}
		c.Image = image.String
		c.HitDie = int(hitDie.Int64)
		c.Caster = caster.String
		c.SubclassLevel = int(subLv.Int64)
		c.Subclasses = []Subclass{}
		out = append(out, c)
	}
	return out, rows.Err()
}

func querySubclasses(db *sql.DB) ([]Subclass, error) {
	rows, err := db.Query(Q("GetAllSubclasses"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Subclass{}
	for rows.Next() {
		var (
			s        Subclass
			image    sql.NullString
			dataJSON string
		)
		if err := rows.Scan(&s.ID, &s.ClassID, &s.Name, &image, &dataJSON, &s.IsCustom); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(dataJSON), &s.Data); err != nil {
			return nil, err
		}
		s.Image = image.String
		out = append(out, s)
	}
	return out, rows.Err()
}
