package main

import (
	"database/sql"
	"encoding/json"
)

// Weapon is a weapon. Data holds the rest of the JSON (mastery, properties, range...).
type Weapon struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Image      string         `json:"image"`
	Category   string         `json:"category"` // simple | martial
	Damage     string         `json:"damage"`
	DamageType string         `json:"damageType"`
	IsDefault  bool           `json:"isDefault"` // false: named/magic
	Data       map[string]any `json:"data"`
}

// Armor is armor or a shield. Data holds addDex, maxDex, stealthDisadvantage, strengthReq...
type Armor struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Image     string         `json:"image"`
	Category  string         `json:"category"` // clothing | light | medium | heavy | shield (clothing doesn't count as armor)
	BaseAC    int            `json:"baseAC"`
	IsDefault bool           `json:"isDefault"`
	Data      map[string]any `json:"data"`
}

// Item is a piece of adventuring gear.
type Item struct {
	ID     string         `json:"id"`
	Name   string         `json:"name"`
	Image  string         `json:"image"`
	Weight float64        `json:"weight"`
	Cost   string         `json:"cost"`
	Desc   string         `json:"desc"`
	Data   map[string]any `json:"data"`
}

// PackItem is an item in a pack, with its quantity.
type PackItem struct {
	Item Item `json:"item"`
	Qty  int  `json:"qty"`
}

// PackArmor is wearable gear in a pack (clothes), with its quantity.
type PackArmor struct {
	Armor Armor `json:"armor"`
	Qty   int   `json:"qty"`
}

// Pack is an equipment pack with its contents.
type Pack struct {
	ID    string         `json:"id"`
	Name  string         `json:"name"`
	Image string         `json:"image"`
	Cost  string         `json:"cost"`
	Desc  string         `json:"desc"`
	Data  map[string]any `json:"data"`
	Items []PackItem     `json:"items"`
	Armor []PackArmor    `json:"armor"` // from the pack JSON "armor": [{ id, qty }] (clothes)
}

// Catalog is ALL equipment, including named items (for handing items out to a character).
type Catalog struct {
	Weapons []Weapon `json:"weapons"`
	Armor   []Armor  `json:"armor"`
	Items   []Item   `json:"items"`
}

func getCatalog(db *sql.DB) (Catalog, error) {
	var (
		c   Catalog
		err error
	)
	if c.Weapons, err = queryWeapons(db, "GetAllWeapons"); err != nil {
		return c, err
	}
	if c.Armor, err = queryArmor(db, "GetAllArmor"); err != nil {
		return c, err
	}
	if c.Items, err = queryItems(db, "GetAllItems"); err != nil {
		return c, err
	}
	return c, nil
}

// Equipment is all equipment for the builder (is_default = 1 only).
type Equipment struct {
	Weapons []Weapon `json:"weapons"`
	Armor   []Armor  `json:"armor"`
	Items   []Item   `json:"items"`
	Packs   []Pack   `json:"packs"`
}

func getEquipment(db *sql.DB) (Equipment, error) {
	var (
		eq  Equipment
		err error
	)
	if eq.Weapons, err = queryWeapons(db, "GetDefaultWeapons"); err != nil {
		return eq, err
	}
	if eq.Armor, err = queryArmor(db, "GetDefaultArmor"); err != nil {
		return eq, err
	}
	if eq.Items, err = queryItems(db, "GetDefaultItems"); err != nil {
		return eq, err
	}
	if eq.Packs, err = queryPacks(db); err != nil {
		return eq, err
	}
	return eq, nil
}

func unmarshalData(s string) (map[string]any, error) {
	m := map[string]any{}
	if s == "" {
		return m, nil
	}
	err := json.Unmarshal([]byte(s), &m)
	return m, err
}

func queryWeapons(db *sql.DB, query string) ([]Weapon, error) {
	rows, err := db.Query(Q(query))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Weapon{}
	for rows.Next() {
		var (
			w                         Weapon
			image, damage, damageType sql.NullString
			data                      string
		)
		if err := rows.Scan(&w.ID, &w.Name, &image, &w.Category, &damage, &damageType, &data, &w.IsDefault); err != nil {
			return nil, err
		}
		if w.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		w.Image, w.Damage, w.DamageType = image.String, damage.String, damageType.String
		out = append(out, w)
	}
	return out, rows.Err()
}

func queryArmor(db *sql.DB, query string) ([]Armor, error) {
	rows, err := db.Query(Q(query))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Armor{}
	for rows.Next() {
		var (
			a      Armor
			image  sql.NullString
			baseAC sql.NullInt64
			data   string
		)
		if err := rows.Scan(&a.ID, &a.Name, &image, &a.Category, &baseAC, &data, &a.IsDefault); err != nil {
			return nil, err
		}
		if a.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		a.Image, a.BaseAC = image.String, int(baseAC.Int64)
		out = append(out, a)
	}
	return out, rows.Err()
}

func queryItems(db *sql.DB, query string) ([]Item, error) {
	rows, err := db.Query(Q(query))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Item{}
	for rows.Next() {
		it, err := readItem(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// readItem reads the columns id, name, image, weight, cost, description, data_json
// (plus any columns before them, via prefix).
func readItem(scan func(...any) error, prefix ...any) (Item, error) {
	var (
		it                Item
		image, cost, desc sql.NullString
		weight            sql.NullFloat64
		data              string
	)
	dest := append(prefix, &it.ID, &it.Name, &image, &weight, &cost, &desc, &data)
	if err := scan(dest...); err != nil {
		return it, err
	}
	var err error
	if it.Data, err = unmarshalData(data); err != nil {
		return it, err
	}
	it.Image, it.Weight, it.Cost, it.Desc = image.String, weight.Float64, cost.String, desc.String
	return it, nil
}

func queryPacks(db *sql.DB) ([]Pack, error) {
	rows, err := db.Query(Q("GetDefaultPacks"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	packs := []Pack{}
	for rows.Next() {
		var (
			p                 Pack
			image, cost, desc sql.NullString
			data              string
		)
		if err := rows.Scan(&p.ID, &p.Name, &image, &cost, &desc, &data); err != nil {
			return nil, err
		}
		if p.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		p.Image, p.Cost, p.Desc = image.String, cost.String, desc.String
		p.Items = []PackItem{}
		packs = append(packs, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	// pack contents via pack_items
	index := make(map[string]int, len(packs))
	for i, p := range packs {
		index[p.ID] = i
	}

	itemRows, err := db.Query(Q("GetPackItems"))
	if err != nil {
		return nil, err
	}
	defer itemRows.Close()

	for itemRows.Next() {
		var (
			packID string
			qty    int
		)
		it, err := readItem(itemRows.Scan, &packID, &qty)
		if err != nil {
			return nil, err
		}
		if i, ok := index[packID]; ok {
			packs[i].Items = append(packs[i].Items, PackItem{Item: it, Qty: qty})
		}
	}
	if err := itemRows.Err(); err != nil {
		return nil, err
	}
	itemRows.Close() // free the connection before the next query

	// wearable gear (clothes) lives in the armor table: the pack keeps "armor": [{ id, qty }] in data_json
	allArmor, err := queryArmor(db, "GetAllArmor")
	if err != nil {
		return nil, err
	}
	armorByID := make(map[string]Armor, len(allArmor))
	for _, a := range allArmor {
		armorByID[a.ID] = a
	}
	for i := range packs {
		packs[i].Armor = []PackArmor{}
		list, _ := packs[i].Data["armor"].([]any)
		for _, x := range list {
			m, _ := x.(map[string]any)
			id, _ := m["id"].(string)
			a, ok := armorByID[id]
			if !ok {
				continue
			}
			qty := 1
			if q, ok := m["qty"].(float64); ok && q > 0 {
				qty = int(q)
			}
			packs[i].Armor = append(packs[i].Armor, PackArmor{Armor: a, Qty: qty})
		}
		delete(packs[i].Data, "armor")
	}
	return packs, nil
}
