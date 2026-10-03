package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Campaigns: the DM's campaigns (db/schema/campaigns.sql) — the campaign itself, its
// locations (a tree), NPCs, quests, factions, encounters (presets linked to the campaign)
// and links.

// Campaign is one campaign; Npcs … Factions — how many are in it (for the list).
type Campaign struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Status      string         `json:"status"` // planned | active | paused | finished
	Data        map[string]any `json:"data"`
	CreatedAt   int64          `json:"createdAt"` // unix time
	UpdatedAt   int64          `json:"updatedAt"`
	Npcs        int            `json:"npcs"`
	Locations   int            `json:"locations"`
	Encounters  int            `json:"encounters"`
	Quests      int            `json:"quests"`
	Factions    int            `json:"factions"`
	Sessions    int            `json:"sessions"`
}

var campaignStatuses = map[string]bool{"planned": true, "active": true, "paused": true, "finished": true}

func scanCampaign(scan func(...any) error) (Campaign, error) {
	var (
		c    Campaign
		data string
	)
	if err := scan(&c.ID, &c.Name, &c.Description, &c.Status, &data, &c.CreatedAt, &c.UpdatedAt, &c.Npcs, &c.Locations, &c.Encounters, &c.Quests, &c.Factions, &c.Sessions); err != nil {
		return c, err
	}
	var err error
	c.Data, err = unmarshalData(data)
	return c, err
}

func getCampaigns(db *sql.DB) ([]Campaign, error) {
	rows, err := db.Query(Q("GetAllCampaigns"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Campaign{}
	for rows.Next() {
		c, err := scanCampaign(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func getCampaign(db *sql.DB, id string) (Campaign, error) {
	c, err := scanCampaign(db.QueryRow(Q("GetCampaign"), id).Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return c, fmt.Errorf("campaign not found")
	}
	return c, err
}

// saveCampaign creates (no id) or updates a campaign and returns its id.
func saveCampaign(db *sql.DB, raw string) (string, error) {
	var c Campaign
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		return "", err
	}
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		return "", fmt.Errorf("enter a campaign name")
	}
	if c.ID == "" {
		c.ID = "cmp_" + strings.TrimPrefix(newCustomID(), "custom_")
	}
	if !campaignStatuses[c.Status] {
		c.Status = "active"
	}
	if c.Data == nil {
		c.Data = map[string]any{}
	}
	data, err := json.Marshal(c.Data)
	if err != nil {
		return "", err
	}
	if _, err := db.Exec(Q("UpsertCampaign"), c.ID, c.Name, strings.TrimSpace(c.Description), c.Status, string(data)); err != nil {
		return "", err
	}
	return c.ID, nil
}

// ---------- bound methods ----------

// GetCampaigns returns the campaigns, most recently changed first.
func (a *App) GetCampaigns() ([]Campaign, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getCampaigns(db)
}

// GetCampaign returns one campaign.
func (a *App) GetCampaign(id string) (Campaign, error) {
	db, err := a.conn()
	if err != nil {
		return Campaign{}, err
	}
	return getCampaign(db, id)
}

// SaveCampaign creates (without an id) or updates a campaign. Returns the id.
func (a *App) SaveCampaign(campaignJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	return saveCampaign(db, campaignJSON)
}

// DeleteCampaign deletes a campaign with everything in it (NPCs, locations, links).
func (a *App) DeleteCampaign(id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	return deleteCampaign(db, id)
}

// deleteCampaign removes the campaign and everything in it in one transaction
// (links first: they point at the NPCs and locations).
func deleteCampaign(db *sql.DB, id string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, q := range []string{"DeleteCampaignLinks", "DeleteCampaignBoardNodes", "DeleteCampaignBoards",
		"DeleteCampaignEvents", "DeleteCampaignSessions",
		"DeleteCampaignQuests", "DeleteCampaignFactions",
		"DeleteCampaignNpcs", "DeleteCampaignLocations", "DeleteCampaign"} {
		if _, err := tx.Exec(Q(q), id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---------- locations ----------

// Location is a place in a campaign; ParentID "" — top level.
type Location struct {
	ID         string         `json:"id"`
	CampaignID string         `json:"campaignId"`
	ParentID   string         `json:"parentId"`
	Name       string         `json:"name"`
	Type       string         `json:"type"`
	Image      string         `json:"image"`
	Visible    bool           `json:"visible"`
	Data       map[string]any `json:"data"` // readAloud, notes, tags…
	CreatedAt  int64          `json:"createdAt"`
	UpdatedAt  int64          `json:"updatedAt"`
}

// NPC is a person in a campaign.
type NPC struct {
	ID         string         `json:"id"`
	CampaignID string         `json:"campaignId"`
	Name       string         `json:"name"`
	Portrait   string         `json:"portrait"`
	Role       string         `json:"role"`
	Race       string         `json:"race"`
	Status     string         `json:"status"`     // alive | dead | missing | unknown
	Attitude   string         `json:"attitude"`   // hostile | unfriendly | neutral | friendly | ally
	LocationID string         `json:"locationId"` // "" — nowhere in particular
	MonsterID  string         `json:"monsterId"`  // statblock from the bestiary, "" — none
	Visible    bool           `json:"visible"`
	Data       map[string]any `json:"data"` // appearance, voice, motivation, secret, notes, tags…
	CreatedAt  int64          `json:"createdAt"`
	UpdatedAt  int64          `json:"updatedAt"`
}

var (
	npcStatuses  = map[string]bool{"alive": true, "dead": true, "missing": true, "unknown": true}
	npcAttitudes = map[string]bool{"hostile": true, "unfriendly": true, "neutral": true, "friendly": true, "ally": true}
)

// querier is *sql.DB or *sql.Tx (execer has only Exec).
type querier interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

// nullable: "" → NULL
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func dataJSON(m map[string]any) (string, error) {
	if m == nil {
		m = map[string]any{}
	}
	b, err := json.Marshal(m)
	return string(b), err
}

func campaignExists(q querier, id string) error {
	var x string
	err := q.QueryRow("SELECT id FROM campaigns WHERE id = ?", id).Scan(&x)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("campaign not found")
	}
	return err
}

// ownerOf returns the campaign of a location / NPC ("" if there is none).
func ownerOf(q querier, query, id string) (string, error) {
	var c string
	err := q.QueryRow(Q(query), id).Scan(&c)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return c, err
}

func getLocations(q querier, campaignID string) ([]Location, error) {
	rows, err := q.Query(Q("GetCampaignLocations"), campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Location{}
	for rows.Next() {
		var (
			l             Location
			parent, image sql.NullString
			visible       int
			data          string
		)
		if err := rows.Scan(&l.ID, &l.CampaignID, &parent, &l.Name, &l.Type, &image, &visible, &data, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		if l.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		l.ParentID, l.Image, l.Visible = parent.String, image.String, visible == 1
		out = append(out, l)
	}
	return out, rows.Err()
}

// saveLocation creates (no id) or updates a location and returns its id.
// The parent must be in the same campaign and not the location itself or one of its sub-locations.
func saveLocation(db *sql.DB, raw string) (string, error) {
	var l Location
	if err := json.Unmarshal([]byte(raw), &l); err != nil {
		return "", err
	}
	l.Name = strings.TrimSpace(l.Name)
	if l.Name == "" {
		return "", fmt.Errorf("enter a location name")
	}
	tx, err := db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	if err := campaignExists(tx, l.CampaignID); err != nil {
		return "", err
	}
	if l.ID == "" {
		l.ID = "loc_" + strings.TrimPrefix(newCustomID(), "custom_")
	} else if owner, err := ownerOf(tx, "GetLocationCampaign", l.ID); err != nil {
		return "", err
	} else if owner != "" && owner != l.CampaignID {
		return "", fmt.Errorf("this location belongs to another campaign")
	}
	if l.ParentID != "" {
		all, err := getLocations(tx, l.CampaignID)
		if err != nil {
			return "", err
		}
		parent := map[string]string{}
		for _, x := range all {
			parent[x.ID] = x.ParentID
		}
		if _, ok := parent[l.ParentID]; !ok {
			return "", fmt.Errorf("the parent location is not in this campaign")
		}
		// walking up from the new parent must not reach this location (no loops)
		for p, n := l.ParentID, 0; p != "" && n <= len(all); p, n = parent[p], n+1 {
			if p == l.ID {
				return "", fmt.Errorf("a location can't be inside itself")
			}
		}
	}
	if l.Image, err = storeImage(tx, l.Image); err != nil {
		return "", err
	}
	data, err := dataJSON(l.Data)
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(Q("UpsertLocation"), l.ID, l.CampaignID, nullable(l.ParentID), l.Name,
		strings.TrimSpace(l.Type), nullable(l.Image), boolInt(l.Visible), data); err != nil {
		return "", err
	}
	if _, err := tx.Exec(Q("TouchCampaign"), l.CampaignID); err != nil {
		return "", err
	}
	return l.ID, tx.Commit()
}

// deleteLocation removes a location: its sub-locations move up to its parent,
// NPCs there lose their location, its links are deleted.
func deleteLocation(db *sql.DB, id string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var campaignID string
	var parent sql.NullString
	err = tx.QueryRow("SELECT campaign_id, parent_id FROM campaign_locations WHERE id = ?", id).Scan(&campaignID, &parent)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	steps := []struct {
		q    string
		args []any
	}{
		{"ReparentLocations", []any{nullable(parent.String), id}},
		{"UnsetNpcLocation", []any{id}},
		{"UnsetQuestLocation", []any{id}},
		{"UnsetFactionHq", []any{id}},
		{"DeleteLinksOf", []any{"location", id, "location", id}},
		{"DeleteLocation", []any{id}},
		{"UnsetStartLocation", []any{campaignID, id}},
		{"TouchCampaign", []any{campaignID}},
	}
	if err := dropFromRoutes(tx, campaignID, id); err != nil {
		return err
	}
	for _, s := range steps {
		if _, err := tx.Exec(Q(s.q), s.args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---------- NPCs ----------

func getNpcs(db *sql.DB, campaignID string) ([]NPC, error) {
	rows, err := db.Query(Q("GetCampaignNpcs"), campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []NPC{}
	for rows.Next() {
		var (
			n                           NPC
			portrait, location, monster sql.NullString
			visible                     int
			data                        string
		)
		if err := rows.Scan(&n.ID, &n.CampaignID, &n.Name, &portrait, &n.Role, &n.Race, &n.Status, &n.Attitude,
			&location, &monster, &visible, &data, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		if n.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		n.Portrait, n.LocationID, n.MonsterID, n.Visible = portrait.String, location.String, monster.String, visible == 1
		out = append(out, n)
	}
	return out, rows.Err()
}

// saveNpc creates (no id) or updates an NPC and returns its id.
func saveNpc(db *sql.DB, raw string) (string, error) {
	var n NPC
	if err := json.Unmarshal([]byte(raw), &n); err != nil {
		return "", err
	}
	n.Name = strings.TrimSpace(n.Name)
	if n.Name == "" {
		return "", fmt.Errorf("enter the NPC's name")
	}
	if !npcStatuses[n.Status] {
		n.Status = "alive"
	}
	if !npcAttitudes[n.Attitude] {
		n.Attitude = "neutral"
	}
	tx, err := db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	if err := campaignExists(tx, n.CampaignID); err != nil {
		return "", err
	}
	if n.ID == "" {
		n.ID = "npc_" + strings.TrimPrefix(newCustomID(), "custom_")
	} else if owner, err := ownerOf(tx, "GetNpcCampaign", n.ID); err != nil {
		return "", err
	} else if owner != "" && owner != n.CampaignID {
		return "", fmt.Errorf("this NPC belongs to another campaign")
	}
	if n.LocationID != "" {
		owner, err := ownerOf(tx, "GetLocationCampaign", n.LocationID)
		if err != nil {
			return "", err
		}
		if owner != n.CampaignID {
			return "", fmt.Errorf("the location is not in this campaign")
		}
	}
	if n.Portrait, err = storeImage(tx, n.Portrait); err != nil {
		return "", err
	}
	data, err := dataJSON(n.Data)
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(Q("UpsertNpc"), n.ID, n.CampaignID, n.Name, nullable(n.Portrait), strings.TrimSpace(n.Role),
		strings.TrimSpace(n.Race), n.Status, n.Attitude, nullable(n.LocationID), nullable(n.MonsterID),
		boolInt(n.Visible), data); err != nil {
		return "", err
	}
	if _, err := tx.Exec(Q("TouchCampaign"), n.CampaignID); err != nil {
		return "", err
	}
	return n.ID, tx.Commit()
}

// deleteNpc removes an NPC and its links.
func deleteNpc(db *sql.DB, id string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	campaignID, err := ownerOf(tx, "GetNpcCampaign", id)
	if err != nil || campaignID == "" {
		return err
	}
	for _, s := range []struct {
		q    string
		args []any
	}{
		{"DeleteLinksOf", []any{"npc", id, "npc", id}},
		{"UnsetNpcRefs", []any{id}},
		{"UnsetFactionLeader", []any{id}},
		{"DeleteNpc", []any{id}},
		{"TouchCampaign", []any{campaignID}},
	} {
		if _, err := tx.Exec(Q(s.q), s.args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ---------- bound methods: locations and NPCs ----------

// GetCampaignLocations returns a campaign's locations (a flat list; parentId makes the tree).
func (a *App) GetCampaignLocations(campaignID string) ([]Location, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getLocations(db, campaignID)
}

// SaveLocation creates (without an id) or updates a location. Returns the id.
func (a *App) SaveLocation(locationJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	return saveLocation(db, locationJSON)
}

// DeleteLocation deletes a location (sub-locations move up, NPCs there lose it).
func (a *App) DeleteLocation(id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	return deleteLocation(db, id)
}

// GetCampaignNpcs returns a campaign's NPCs.
func (a *App) GetCampaignNpcs(campaignID string) ([]NPC, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getNpcs(db, campaignID)
}

// SaveNpc creates (without an id) or updates an NPC. Returns the id.
func (a *App) SaveNpc(npcJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	return saveNpc(db, npcJSON)
}

// DeleteNpc deletes an NPC and its links.
func (a *App) DeleteNpc(id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	return deleteNpc(db, id)
}

// ---------- links ----------

// Link connects two things in a campaign (the arrows of the future board).
type Link struct {
	ID         string `json:"id"`
	CampaignID string `json:"campaignId"`
	FromType   string `json:"fromType"`
	FromID     string `json:"fromId"`
	ToType     string `json:"toType"`
	ToID       string `json:"toId"`
	Kind       string `json:"kind"` // lives_in | knows | ally | enemy | includes | happens_at | …
	Note       string `json:"note"`
	CreatedAt  int64  `json:"createdAt"`
}

// what a link can point at, and the query that finds its campaign ("" — global, e.g. encounters)
var linkTypes = map[string]string{
	"campaign":  "",
	"npc":       "GetNpcCampaign",
	"location":  "GetLocationCampaign",
	"encounter": "",
	"character": "",
	"quest":     "GetQuestCampaign",
	"faction":   "GetFactionCampaign",
	"session":   "GetSessionCampaign",
}

func getLinks(db *sql.DB, campaignID string) ([]Link, error) {
	rows, err := db.Query(Q("GetCampaignLinks"), campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Link{}
	for rows.Next() {
		var l Link
		if err := rows.Scan(&l.ID, &l.CampaignID, &l.FromType, &l.FromID, &l.ToType, &l.ToID, &l.Kind, &l.Note, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// checkEnd: the end of a link exists (and, for NPCs / locations, is in this campaign).
func checkEnd(q querier, campaignID, typ, id string) error {
	query, ok := linkTypes[typ]
	if !ok {
		return fmt.Errorf("unknown link end type %q", typ)
	}
	if id == "" {
		return fmt.Errorf("a link end has no id")
	}
	switch {
	case typ == "campaign":
		if id != campaignID {
			return fmt.Errorf("a link can only start at its own campaign")
		}
	case typ == "encounter":
		var n int
		if err := q.QueryRow(Q("EncounterExists"), id).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return fmt.Errorf("encounter not found")
		}
	case query != "":
		owner, err := ownerOf(q, query, id)
		if err != nil {
			return err
		}
		if owner != campaignID {
			return fmt.Errorf("the %s is not in this campaign", typ)
		}
	}
	return nil
}

// putLink creates the link (or updates its note) and returns its id.
func putLink(q querier, l Link) (string, error) {
	if err := campaignExists(q, l.CampaignID); err != nil {
		return "", err
	}
	if err := checkEnd(q, l.CampaignID, l.FromType, l.FromID); err != nil {
		return "", err
	}
	if err := checkEnd(q, l.CampaignID, l.ToType, l.ToID); err != nil {
		return "", err
	}
	l.Kind = strings.TrimSpace(l.Kind)
	if l.ID == "" {
		l.ID = "lnk_" + strings.TrimPrefix(newCustomID(), "custom_")
	}
	if _, err := q.Exec(Q("UpsertLink"), l.ID, l.CampaignID, l.FromType, l.FromID, l.ToType, l.ToID, l.Kind, strings.TrimSpace(l.Note)); err != nil {
		return "", err
	}
	// on a conflict the existing row keeps its id
	var id string
	err := q.QueryRow(Q("GetLinkId"), l.CampaignID, l.FromType, l.FromID, l.ToType, l.ToID, l.Kind).Scan(&id)
	return id, err
}

func saveLink(db *sql.DB, raw string) (string, error) {
	var l Link
	if err := json.Unmarshal([]byte(raw), &l); err != nil {
		return "", err
	}
	tx, err := db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	id, err := putLink(tx, l)
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(Q("TouchCampaign"), l.CampaignID); err != nil {
		return "", err
	}
	return id, tx.Commit()
}

// ---------- encounters in a campaign ----------

// CampaignEncounter is an encounter preset as a campaign uses it; LocationID — where it happens.
type CampaignEncounter struct {
	Encounter
	LocationID string `json:"locationId"`
}

func getCampaignEncounters(db *sql.DB, campaignID string) ([]CampaignEncounter, error) {
	rows, err := db.Query(Q("GetCampaignEncounters"), campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CampaignEncounter{}
	for rows.Next() {
		var (
			e    CampaignEncounter
			list string
		)
		if err := rows.Scan(&e.ID, &e.Name, &e.Notes, &list, &e.UpdatedAt, &e.LocationID); err != nil {
			return nil, err
		}
		e.Monsters = []EncounterMonster{}
		_ = json.Unmarshal([]byte(list), &e.Monsters)
		out = append(out, e)
	}
	return out, rows.Err()
}

// saveCampaignEncounter saves the preset (new or changed) and puts it in the campaign, at
// locationID ("" — nowhere in particular). Returns the encounter id.
func saveCampaignEncounter(db *sql.DB, campaignID, encounterJSON, locationID string) (string, error) {
	tx, err := db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if err := campaignExists(tx, campaignID); err != nil {
		return "", err
	}
	id, err := saveEncounter(tx, encounterJSON)
	if err != nil {
		return "", err
	}
	if err := placeEncounter(tx, campaignID, id, locationID); err != nil {
		return "", err
	}
	return id, tx.Commit()
}

// placeEncounter: the campaign includes the encounter; it happens at locationID (or nowhere).
func placeEncounter(q querier, campaignID, encounterID, locationID string) error {
	if _, err := putLink(q, Link{CampaignID: campaignID, FromType: "campaign", FromID: campaignID,
		ToType: "encounter", ToID: encounterID, Kind: "includes"}); err != nil {
		return err
	}
	if _, err := q.Exec(Q("DeleteLinksFrom"), campaignID, "encounter", encounterID, "happens_at"); err != nil {
		return err
	}
	if locationID != "" {
		if _, err := putLink(q, Link{CampaignID: campaignID, FromType: "encounter", FromID: encounterID,
			ToType: "location", ToID: locationID, Kind: "happens_at"}); err != nil {
			return err
		}
	}
	_, err := q.Exec(Q("TouchCampaign"), campaignID)
	return err
}

// addCampaignEncounter puts an existing preset into the campaign.
func addCampaignEncounter(db *sql.DB, campaignID, encounterID, locationID string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := placeEncounter(tx, campaignID, encounterID, locationID); err != nil {
		return err
	}
	return tx.Commit()
}

// removeCampaignEncounter takes an encounter out of the campaign (its links in this campaign);
// deletePreset — delete the preset itself too (it leaves every campaign and the Bestiary).
func removeCampaignEncounter(db *sql.DB, campaignID, encounterID string, deletePreset bool) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if deletePreset {
		if _, err := tx.Exec(Q("DeleteLinksOf"), "encounter", encounterID, "encounter", encounterID); err != nil {
			return err
		}
		if _, err := tx.Exec(Q("DeleteEncounter"), encounterID); err != nil {
			return err
		}
	} else if _, err := tx.Exec(Q("DeleteCampaignLinksOf"), campaignID, "encounter", encounterID, "encounter", encounterID); err != nil {
		return err
	}
	if _, err := tx.Exec(Q("TouchCampaign"), campaignID); err != nil {
		return err
	}
	return tx.Commit()
}

// ---------- bound methods: links and encounters ----------

// GetCampaignLinks returns every link in a campaign.
func (a *App) GetCampaignLinks(campaignID string) ([]Link, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getLinks(db, campaignID)
}

// SaveLink creates a link (or updates the note of the same one). Returns the id.
func (a *App) SaveLink(linkJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	return saveLink(db, linkJSON)
}

// DeleteLink deletes a link.
func (a *App) DeleteLink(id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(Q("DeleteLink"), id)
	return err
}

// GetCampaignEncounters returns the encounters a campaign uses, with where each happens.
func (a *App) GetCampaignEncounters(campaignID string) ([]CampaignEncounter, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getCampaignEncounters(db, campaignID)
}

// SaveCampaignEncounter creates or updates an encounter preset and puts it in the campaign
// at a location ("" — none). Returns the encounter id.
func (a *App) SaveCampaignEncounter(campaignID, encounterJSON, locationID string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	return saveCampaignEncounter(db, campaignID, encounterJSON, locationID)
}

// AddCampaignEncounter puts an existing preset (from the Bestiary) into the campaign.
func (a *App) AddCampaignEncounter(campaignID, encounterID, locationID string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	return addCampaignEncounter(db, campaignID, encounterID, locationID)
}

// RemoveCampaignEncounter takes an encounter out of the campaign; deletePreset also deletes
// the preset (from the Bestiary and every campaign).
func (a *App) RemoveCampaignEncounter(campaignID, encounterID string, deletePreset bool) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	return removeCampaignEncounter(db, campaignID, encounterID, deletePreset)
}

// ---------- seed (dev mode: assets/data/campaigns/*.json) ----------

// campaignSeed is one file: a campaign with everything in it. Ids are fixed, so the
// links can refer to them; "type:id" in links ("npc:npc_hilda", "location:loc_millbrook").
type campaignSeed struct {
	Campaign
	Locations  []Location `json:"locations"`
	Npcs       []NPC      `json:"npcs"`
	Encounters []struct {
		Encounter
		LocationID string `json:"locationId"`
	} `json:"encounters"`
	Quests   []Quest   `json:"quests"`
	Factions []Faction `json:"factions"`
	Sessions []struct {
		Session
		Events []struct {
			Kind    string  `json:"kind"`
			Ref     string  `json:"ref"` // "type:id" or ""
			Outcome string  `json:"outcome"`
			Note    string  `json:"note"`
			Change  *Change `json:"change"`
		} `json:"events"`
	} `json:"sessions"`
	Links []struct {
		From string `json:"from"`
		To   string `json:"to"`
		Kind string `json:"kind"`
		Note string `json:"note"`
	} `json:"links"`
}

func insertCampaignJSON(tx *sql.Tx, raw []byte) error {
	var c campaignSeed
	if err := json.Unmarshal(raw, &c); err != nil {
		return err
	}
	if c.ID == "" || c.Name == "" {
		return fmt.Errorf("missing id or name")
	}
	if !campaignStatuses[c.Status] {
		c.Status = "active"
	}
	data, err := dataJSON(c.Data)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(Q("UpsertCampaign"), c.ID, c.Name, c.Description, c.Status, data); err != nil {
		return err
	}
	// locations: all first without a parent, then the parents (any order in the file)
	for _, l := range c.Locations {
		d, err := dataJSON(l.Data)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(Q("UpsertLocation"), l.ID, c.ID, nil, l.Name, l.Type, nullable(l.Image), boolInt(l.Visible), d); err != nil {
			return fmt.Errorf("location %s: %w", l.ID, err)
		}
	}
	for _, l := range c.Locations {
		if l.ParentID == "" {
			continue
		}
		if _, err := tx.Exec("UPDATE campaign_locations SET parent_id = ? WHERE id = ?", l.ParentID, l.ID); err != nil {
			return fmt.Errorf("location %s: %w", l.ID, err)
		}
	}
	for _, n := range c.Npcs {
		d, err := dataJSON(n.Data)
		if err != nil {
			return err
		}
		if !npcStatuses[n.Status] {
			n.Status = "alive"
		}
		if !npcAttitudes[n.Attitude] {
			n.Attitude = "neutral"
		}
		if _, err := tx.Exec(Q("UpsertNpc"), n.ID, c.ID, n.Name, nullable(n.Portrait), n.Role, n.Race, n.Status, n.Attitude,
			nullable(n.LocationID), nullable(n.MonsterID), boolInt(n.Visible), d); err != nil {
			return fmt.Errorf("npc %s: %w", n.ID, err)
		}
	}
	for _, e := range c.Encounters {
		b, err := json.Marshal(e.Encounter)
		if err != nil {
			return err
		}
		if _, err := saveEncounter(tx, string(b)); err != nil {
			return fmt.Errorf("encounter %s: %w", e.ID, err)
		}
		if err := placeEncounter(tx, c.ID, e.ID, e.LocationID); err != nil {
			return fmt.Errorf("encounter %s: %w", e.ID, err)
		}
	}
	for _, x := range c.Quests {
		x.CampaignID = c.ID
		if _, err := putQuest(tx, x); err != nil {
			return fmt.Errorf("quest %s: %w", x.ID, err)
		}
	}
	for _, x := range c.Factions {
		x.CampaignID = c.ID
		if _, err := putFaction(tx, x); err != nil {
			return fmt.Errorf("faction %s: %w", x.ID, err)
		}
	}
	// sessions: their log goes through addEvent, so the events apply their changes (variant B)
	for _, ss := range c.Sessions {
		ss.CampaignID = c.ID
		sid, err := putSession(tx, ss.Session)
		if err != nil {
			return fmt.Errorf("session %s: %w", ss.ID, err)
		}
		for i, ev := range ss.Events {
			e := Event{SessionID: sid, Kind: ev.Kind, Outcome: ev.Outcome, Note: ev.Note, Change: ev.Change, Position: i + 1}
			if ev.Ref != "" {
				e.RefType, e.RefID, _ = strings.Cut(ev.Ref, ":")
			}
			if _, err := addEvent(tx, e, false); err != nil {
				return fmt.Errorf("session %s, event %d (%s): %w", ss.ID, i+1, ev.Kind, err)
			}
		}
	}
	for _, l := range c.Links {
		ft, fid, ok1 := strings.Cut(l.From, ":")
		tt, tid, ok2 := strings.Cut(l.To, ":")
		if !ok1 || !ok2 {
			return fmt.Errorf("link %q → %q: use type:id", l.From, l.To)
		}
		if _, err := putLink(tx, Link{CampaignID: c.ID, FromType: ft, FromID: fid, ToType: tt, ToID: tid, Kind: l.Kind, Note: l.Note}); err != nil {
			return fmt.Errorf("link %s → %s: %w", l.From, l.To, err)
		}
	}
	return nil
}

// ---------- quests and factions ----------

// Quest is a plot thread; objectives live in Data ("objectives": [{ "text", "done" }]).
type Quest struct {
	ID         string         `json:"id"`
	CampaignID string         `json:"campaignId"`
	Name       string         `json:"name"`
	Kind       string         `json:"kind"`   // main | side | personal
	Status     string         `json:"status"` // open | active | completed | failed | abandoned
	GiverNpcID string         `json:"giverNpcId"`
	LocationID string         `json:"locationId"`
	Reward     string         `json:"reward"`
	Visible    bool           `json:"visible"`
	Data       map[string]any `json:"data"` // summary, objectives, notes, tags…
	CreatedAt  int64          `json:"createdAt"`
	UpdatedAt  int64          `json:"updatedAt"`
}

// Faction is an organisation; its members are NPCs linked to it (npc → faction "member_of").
type Faction struct {
	ID           string         `json:"id"`
	CampaignID   string         `json:"campaignId"`
	Name         string         `json:"name"`
	Type         string         `json:"type"`
	Emblem       string         `json:"emblem"`
	Attitude     string         `json:"attitude"`   // as for NPCs
	Reputation   int            `json:"reputation"` // -10…10
	LeaderNpcID  string         `json:"leaderNpcId"`
	HqLocationID string         `json:"hqLocationId"`
	Visible      bool           `json:"visible"`
	Data         map[string]any `json:"data"` // description, goals, secret, notes, tags…
	CreatedAt    int64          `json:"createdAt"`
	UpdatedAt    int64          `json:"updatedAt"`
}

var (
	questKinds    = map[string]bool{"main": true, "side": true, "personal": true}
	questStatuses = map[string]bool{"open": true, "active": true, "completed": true, "failed": true, "abandoned": true}
)

// refIn: an optional reference ("" is fine) must be a record of this campaign.
func refIn(q querier, query, id, campaignID, what string) error {
	if id == "" {
		return nil
	}
	owner, err := ownerOf(q, query, id)
	if err != nil {
		return err
	}
	if owner != campaignID {
		return fmt.Errorf("the %s is not in this campaign", what)
	}
	return nil
}

// newID: the given id, or a fresh "<prefix>_xxxx"; an existing id must belong to the campaign.
func newID(q querier, id, prefix, ownerQuery, campaignID, what string) (string, error) {
	if id == "" {
		return prefix + "_" + strings.TrimPrefix(newCustomID(), "custom_"), nil
	}
	owner, err := ownerOf(q, ownerQuery, id)
	if err != nil {
		return "", err
	}
	if owner != "" && owner != campaignID {
		return "", fmt.Errorf("this %s belongs to another campaign", what)
	}
	return id, nil
}

func getQuests(db *sql.DB, campaignID string) ([]Quest, error) {
	rows, err := db.Query(Q("GetCampaignQuests"), campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Quest{}
	for rows.Next() {
		var (
			x               Quest
			giver, location sql.NullString
			visible         int
			data            string
		)
		if err := rows.Scan(&x.ID, &x.CampaignID, &x.Name, &x.Kind, &x.Status, &giver, &location, &x.Reward, &visible, &data,
			&x.CreatedAt, &x.UpdatedAt); err != nil {
			return nil, err
		}
		if x.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		x.GiverNpcID, x.LocationID, x.Visible = giver.String, location.String, visible == 1
		out = append(out, x)
	}
	return out, rows.Err()
}

func putQuest(q querier, x Quest) (string, error) {
	x.Name = strings.TrimSpace(x.Name)
	if x.Name == "" {
		return "", fmt.Errorf("enter the quest's name")
	}
	if !questKinds[x.Kind] {
		x.Kind = "side"
	}
	if !questStatuses[x.Status] {
		x.Status = "open"
	}
	if err := campaignExists(q, x.CampaignID); err != nil {
		return "", err
	}
	id, err := newID(q, x.ID, "qst", "GetQuestCampaign", x.CampaignID, "quest")
	if err != nil {
		return "", err
	}
	if err := refIn(q, "GetNpcCampaign", x.GiverNpcID, x.CampaignID, "quest giver"); err != nil {
		return "", err
	}
	if err := refIn(q, "GetLocationCampaign", x.LocationID, x.CampaignID, "location"); err != nil {
		return "", err
	}
	// the route (the campaign board): every step is a location of this campaign
	if route, ok := x.Data["route"].([]any); ok {
		for i, step := range route {
			m, _ := step.(map[string]any)
			loc, _ := m["locationId"].(string)
			if loc == "" {
				return "", fmt.Errorf("route step %d has no location", i+1)
			}
			if err := refIn(q, "GetLocationCampaign", loc, x.CampaignID, "route location"); err != nil {
				return "", err
			}
		}
	}
	data, err := dataJSON(x.Data)
	if err != nil {
		return "", err
	}
	if _, err := q.Exec(Q("UpsertQuest"), id, x.CampaignID, x.Name, x.Kind, x.Status, nullable(x.GiverNpcID),
		nullable(x.LocationID), strings.TrimSpace(x.Reward), boolInt(x.Visible), data); err != nil {
		return "", err
	}
	_, err = q.Exec(Q("TouchCampaign"), x.CampaignID)
	return id, err
}

func getFactions(db *sql.DB, campaignID string) ([]Faction, error) {
	rows, err := db.Query(Q("GetCampaignFactions"), campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Faction{}
	for rows.Next() {
		var (
			x                  Faction
			emblem, leader, hq sql.NullString
			visible            int
			data               string
		)
		if err := rows.Scan(&x.ID, &x.CampaignID, &x.Name, &x.Type, &emblem, &x.Attitude, &x.Reputation, &leader, &hq,
			&visible, &data, &x.CreatedAt, &x.UpdatedAt); err != nil {
			return nil, err
		}
		if x.Data, err = unmarshalData(data); err != nil {
			return nil, err
		}
		x.Emblem, x.LeaderNpcID, x.HqLocationID, x.Visible = emblem.String, leader.String, hq.String, visible == 1
		out = append(out, x)
	}
	return out, rows.Err()
}

func putFaction(q querier, x Faction) (string, error) {
	x.Name = strings.TrimSpace(x.Name)
	if x.Name == "" {
		return "", fmt.Errorf("enter the faction's name")
	}
	if !npcAttitudes[x.Attitude] {
		x.Attitude = "neutral"
	}
	x.Reputation = max(-10, min(10, x.Reputation))
	if err := campaignExists(q, x.CampaignID); err != nil {
		return "", err
	}
	id, err := newID(q, x.ID, "fac", "GetFactionCampaign", x.CampaignID, "faction")
	if err != nil {
		return "", err
	}
	if err := refIn(q, "GetNpcCampaign", x.LeaderNpcID, x.CampaignID, "leader"); err != nil {
		return "", err
	}
	if err := refIn(q, "GetLocationCampaign", x.HqLocationID, x.CampaignID, "headquarters"); err != nil {
		return "", err
	}
	if x.Emblem, err = storeImage(q, x.Emblem); err != nil {
		return "", err
	}
	data, err := dataJSON(x.Data)
	if err != nil {
		return "", err
	}
	if _, err := q.Exec(Q("UpsertFaction"), id, x.CampaignID, x.Name, strings.TrimSpace(x.Type), nullable(x.Emblem),
		x.Attitude, x.Reputation, nullable(x.LeaderNpcID), nullable(x.HqLocationID), boolInt(x.Visible), data); err != nil {
		return "", err
	}
	_, err = q.Exec(Q("TouchCampaign"), x.CampaignID)
	return id, err
}

// inTx runs fn in a transaction and commits it if fn succeeds.
func inTx[T any](db *sql.DB, fn func(tx *sql.Tx) (T, error)) (T, error) {
	var zero T
	tx, err := db.Begin()
	if err != nil {
		return zero, err
	}
	defer tx.Rollback()
	v, err := fn(tx)
	if err != nil {
		return zero, err
	}
	return v, tx.Commit()
}

// deleteThing removes a quest / faction and its links.
func deleteThing(db *sql.DB, typ, ownerQuery, deleteQuery, id string) error {
	_, err := inTx(db, func(tx *sql.Tx) (bool, error) {
		campaignID, err := ownerOf(tx, ownerQuery, id)
		if err != nil || campaignID == "" {
			return false, err
		}
		if _, err := tx.Exec(Q("DeleteLinksOf"), typ, id, typ, id); err != nil {
			return false, err
		}
		if _, err := tx.Exec(Q(deleteQuery), id); err != nil {
			return false, err
		}
		_, err = tx.Exec(Q("TouchCampaign"), campaignID)
		return true, err
	})
	return err
}

// ---------- bound methods: quests and factions ----------

// GetCampaignQuests returns a campaign's quests (active first).
func (a *App) GetCampaignQuests(campaignID string) ([]Quest, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getQuests(db, campaignID)
}

// SaveQuest creates (without an id) or updates a quest. Returns the id.
func (a *App) SaveQuest(questJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	var x Quest
	if err := json.Unmarshal([]byte(questJSON), &x); err != nil {
		return "", err
	}
	return inTx(db, func(tx *sql.Tx) (string, error) { return putQuest(tx, x) })
}

// DeleteQuest deletes a quest and its links.
func (a *App) DeleteQuest(id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	return deleteThing(db, "quest", "GetQuestCampaign", "DeleteQuest", id)
}

// GetCampaignFactions returns a campaign's factions.
func (a *App) GetCampaignFactions(campaignID string) ([]Faction, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getFactions(db, campaignID)
}

// SaveFaction creates (without an id) or updates a faction. Returns the id.
func (a *App) SaveFaction(factionJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	var x Faction
	if err := json.Unmarshal([]byte(factionJSON), &x); err != nil {
		return "", err
	}
	return inTx(db, func(tx *sql.Tx) (string, error) { return putFaction(tx, x) })
}

// DeleteFaction deletes a faction and its links (its members stay, without the membership).
func (a *App) DeleteFaction(id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	return deleteThing(db, "faction", "GetFactionCampaign", "DeleteFaction", id)
}
