package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// Campaign maps (db/schema/campaigns.sql: campaign_maps, campaign_map_markers).
//
// Every location and every encounter of a campaign can have its own map — a layer: terrain
// painted into grid cells plus markers standing in cells. Markers follow the "one level"
// rule: on a location's map — its direct child locations, its NPCs and its encounters.
// An encounter's map has terrain only (the enemies are put there during the game).
//
// The terrain is stored per layer as JSON grouped by tile (one write per stroke, compact):
//
//	{ "v": 1, "tiles": { "grass": [x1, y1, x2, y2, …], "forest": [ … ] } }
//
// A map row appears with the first stroke / marker. What happens to maps when the campaign
// changes (a location deleted or moved…) is in campaigns.go / bestiary.go.

// MapLayerInfo is a map without its cells (the layer menu).
type MapLayerInfo struct {
	OwnerType string `json:"ownerType"` // location | encounter
	OwnerID   string `json:"ownerId"`
	Cells     int    `json:"cells"`
	Markers   int    `json:"markers"`
	UpdatedAt int64  `json:"updatedAt"`
}

// MapLayer is one map: its terrain and markers.
type MapLayer struct {
	OwnerType string           `json:"ownerType"`
	OwnerID   string           `json:"ownerId"`
	Tiles     map[string][]int `json:"tiles"` // tile id → [x1, y1, x2, y2, …]
	Markers   []MapMarker      `json:"markers"`
	Data      map[string]any   `json:"data"`
	UpdatedAt int64            `json:"updatedAt"`
}

// MapMarker is a thing standing in a cell.
type MapMarker struct {
	RefType string `json:"refType"` // location | npc | encounter
	RefID   string `json:"refId"`
	X       int    `json:"x"`
	Y       int    `json:"y"`
}

// mapCells is the cells_json format.
type mapCells struct {
	V     int              `json:"v"`
	Tiles map[string][]int `json:"tiles"`
}

const (
	mapCellsVersion = 1
	maxMapCells     = 200_000 // per layer: far more than anyone paints, a guard against garbage
	maxMapCoord     = 100_000 // |x|, |y|
)

var (
	mapOwnerTypes  = map[string]bool{"location": true, "encounter": true}
	mapMarkerTypes = map[string]bool{"location": true, "npc": true, "encounter": true}
)

// checkMapOwner: the location / encounter must belong to the campaign.
func checkMapOwner(q querier, campaignID, ownerType, ownerID string) error {
	if !mapOwnerTypes[ownerType] || ownerID == "" {
		return fmt.Errorf("a map belongs to a location or an encounter")
	}
	if err := campaignExists(q, campaignID); err != nil {
		return err
	}
	var x string
	var err error
	switch ownerType {
	case "location":
		err = q.QueryRow(Q("GetLocationParent"), ownerID, campaignID).Scan(&x)
	case "encounter":
		err = q.QueryRow(Q("GetEncounterLocation"), campaignID, ownerID).Scan(&x)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("the %s is not in this campaign", ownerType)
	}
	return err
}

// mapID returns the id of the owner's map; create — make it if there is none ("" if not).
func mapID(q querier, campaignID, ownerType, ownerID string, create bool) (string, error) {
	var id, cells, data string
	var updated int64
	err := q.QueryRow(Q("GetMapByOwner"), campaignID, ownerType, ownerID).Scan(&id, &cells, &data, &updated)
	if err == nil || !errors.Is(err, sql.ErrNoRows) || !create {
		if errors.Is(err, sql.ErrNoRows) {
			err = nil
		}
		return id, err
	}
	if err := checkMapOwner(q, campaignID, ownerType, ownerID); err != nil {
		return "", err
	}
	id = "map_" + strings.TrimPrefix(newCustomID(), "custom_")
	_, err = q.Exec(Q("InsertMap"), id, campaignID, ownerType, ownerID)
	return id, err
}

// parseCells checks and normalises cells JSON; returns it re-encoded and the cell count.
// A cell painted twice keeps the last tile.
func parseCells(raw string) (string, int, error) {
	var c mapCells
	if strings.TrimSpace(raw) == "" {
		raw = "{}"
	}
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		return "", 0, fmt.Errorf("bad map cells: %w", err)
	}
	if c.V > mapCellsVersion {
		return "", 0, fmt.Errorf("the map was saved by a newer version of the app")
	}
	seen := map[[2]int]string{}
	for tile, xy := range c.Tiles {
		if tile == "" || len(tile) > 64 {
			return "", 0, fmt.Errorf("bad tile id %q", tile)
		}
		if len(xy)%2 != 0 {
			return "", 0, fmt.Errorf("tile %q: an odd number of coordinates", tile)
		}
		for i := 0; i < len(xy); i += 2 {
			x, y := xy[i], xy[i+1]
			if x < -maxMapCoord || x > maxMapCoord || y < -maxMapCoord || y > maxMapCoord {
				return "", 0, fmt.Errorf("a cell is too far away (%d, %d)", x, y)
			}
			seen[[2]int{x, y}] = tile
		}
	}
	if len(seen) > maxMapCells {
		return "", 0, fmt.Errorf("too many cells on one map (%d)", len(seen))
	}
	out := mapCells{V: mapCellsVersion, Tiles: map[string][]int{}}
	for xy, tile := range seen {
		out.Tiles[tile] = append(out.Tiles[tile], xy[0], xy[1])
	}
	b, err := json.Marshal(out)
	return string(b), len(seen), err
}

// ---------- reading ----------

func getMapLayers(q querier, campaignID string) ([]MapLayerInfo, error) {
	rows, err := q.Query(Q("GetMapLayers"), campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MapLayerInfo{}
	for rows.Next() {
		var l MapLayerInfo
		if err := rows.Scan(&l.OwnerType, &l.OwnerID, &l.Cells, &l.Markers, &l.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// getMapLayer: the owner's map; an empty one if nothing is painted yet.
func getMapLayer(q querier, campaignID, ownerType, ownerID string) (MapLayer, error) {
	l := MapLayer{OwnerType: ownerType, OwnerID: ownerID, Tiles: map[string][]int{}, Markers: []MapMarker{}, Data: map[string]any{}}
	var id, cells, data string
	err := q.QueryRow(Q("GetMapByOwner"), campaignID, ownerType, ownerID).Scan(&id, &cells, &data, &l.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return l, checkMapOwner(q, campaignID, ownerType, ownerID)
	}
	if err != nil {
		return l, err
	}
	var c mapCells
	if err := json.Unmarshal([]byte(cells), &c); err != nil {
		return l, fmt.Errorf("the map's cells are damaged: %w", err)
	}
	if c.Tiles != nil {
		l.Tiles = c.Tiles
	}
	if l.Data, err = unmarshalData(data); err != nil {
		return l, err
	}
	rows, err := q.Query(Q("GetMapMarkers"), id)
	if err != nil {
		return l, err
	}
	defer rows.Close()
	for rows.Next() {
		var m MapMarker
		if err := rows.Scan(&m.RefType, &m.RefID, &m.X, &m.Y); err != nil {
			return l, err
		}
		l.Markers = append(l.Markers, m)
	}
	return l, rows.Err()
}

// ---------- writing ----------

func saveMapCells(q querier, campaignID, ownerType, ownerID, cellsJSON string) error {
	cells, n, err := parseCells(cellsJSON)
	if err != nil {
		return err
	}
	id, err := mapID(q, campaignID, ownerType, ownerID, n > 0)
	if err != nil || id == "" {
		return err // nothing painted and no map yet: nothing to save
	}
	if _, err := q.Exec(Q("SetMapCells"), cells, n, id); err != nil {
		return err
	}
	_, err = q.Exec(Q("TouchCampaign"), campaignID)
	return err
}

// markerFits: the "one level" rule — what may stand on a location's map.
func markerFits(q querier, campaignID, mapOwnerID, refType, refID string) error {
	var where string
	var err error
	switch refType {
	case "location":
		err = q.QueryRow(Q("GetLocationParent"), refID, campaignID).Scan(&where)
	case "npc":
		err = q.QueryRow(Q("GetNpcLocation"), refID, campaignID).Scan(&where)
	case "encounter":
		err = q.QueryRow(Q("GetEncounterLocation"), campaignID, refID).Scan(&where)
	default:
		return fmt.Errorf("a map can't show %q", refType)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("the %s is not in this campaign", refType)
	}
	if err != nil {
		return err
	}
	if where != mapOwnerID {
		switch refType {
		case "location":
			return fmt.Errorf("only the locations directly inside can go on this map")
		case "npc":
			return fmt.Errorf("only the NPCs of this location can go on its map")
		default:
			return fmt.Errorf("only the encounters of this location can go on its map")
		}
	}
	return nil
}

func placeMapMarker(q querier, campaignID, ownerType, ownerID string, m MapMarker) error {
	if ownerType != "location" {
		return fmt.Errorf("an encounter's map has no markers: its enemies are placed during the game")
	}
	if !mapMarkerTypes[m.RefType] || m.RefID == "" {
		return fmt.Errorf("a map can't show %q", m.RefType)
	}
	if abs(m.X) > maxMapCoord || abs(m.Y) > maxMapCoord {
		return fmt.Errorf("the cell is too far away")
	}
	if err := checkMapOwner(q, campaignID, ownerType, ownerID); err != nil {
		return err
	}
	if err := markerFits(q, campaignID, ownerID, m.RefType, m.RefID); err != nil {
		return err
	}
	id, err := mapID(q, campaignID, ownerType, ownerID, true)
	if err != nil {
		return err
	}
	var t, r string
	err = q.QueryRow(Q("MarkerAt"), id, m.X, m.Y).Scan(&t, &r)
	if err == nil && (t != m.RefType || r != m.RefID) {
		return fmt.Errorf("this cell is taken")
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err := q.Exec(Q("UpsertMapMarker"), id, m.RefType, m.RefID, m.X, m.Y); err != nil {
		return err
	}
	_, err = q.Exec(Q("TouchMap"), id)
	return err
}

func removeMapMarker(q querier, campaignID, ownerType, ownerID, refType, refID string) error {
	id, err := mapID(q, campaignID, ownerType, ownerID, false)
	if err != nil || id == "" {
		return err
	}
	if _, err := q.Exec(Q("DeleteMapMarker"), id, refType, refID); err != nil {
		return err
	}
	_, err = q.Exec(Q("TouchMap"), id)
	return err
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// ---------- keeping maps in step with the campaign (called from campaigns.go / bestiary.go) ----------

// dropMapsOf: a location / an encounter left the campaign — its own map and its markers go.
func dropMapsOf(q querier, campaignID, refType, refID string) error {
	steps := [][]any{
		{"DeleteMarkersOfRef", refType, refID, campaignID},
		{"DeleteOwnerMapMarkers", campaignID, refType, refID},
		{"DeleteOwnerMap", campaignID, refType, refID},
	}
	if refType == "npc" {
		steps = steps[:1] // an NPC has no map of its own
	}
	for _, s := range steps {
		if _, err := q.Exec(Q(s[0].(string)), s[1:]...); err != nil {
			return err
		}
	}
	return nil
}

// dropEncounterMapsEverywhere: an encounter preset is deleted — its maps and markers in
// every campaign go.
func dropEncounterMapsEverywhere(q querier, encounterID string) error {
	for _, s := range []string{"DeleteEncounterMapsEverywhere", "DeleteEncounterOwnedMarkers", "DeleteEncounterOwnedMaps"} {
		if _, err := q.Exec(Q(s), encounterID); err != nil {
			return err
		}
	}
	return nil
}

// pruneMarkersOf: a thing moved to another location — its markers stay only on that one's map.
func pruneMarkersOf(q querier, campaignID, refType, refID, newOwnerID string) error {
	_, err := q.Exec(Q("PruneMarkersOfRef"), refType, refID, campaignID, newOwnerID)
	return err
}

// ---------- bound methods ----------

// GetMapLayers lists a campaign's maps without their cells (counts for the layer menu).
func (a *App) GetMapLayers(campaignID string) ([]MapLayerInfo, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getMapLayers(db, campaignID)
}

// GetMapLayer returns the map of a location / an encounter (empty if nothing is painted yet).
func (a *App) GetMapLayer(campaignID, ownerType, ownerID string) (MapLayer, error) {
	db, err := a.conn()
	if err != nil {
		return MapLayer{}, err
	}
	return getMapLayer(db, campaignID, ownerType, ownerID)
}

// SaveMapCells stores a map's terrain: { "v": 1, "tiles": { tileId: [x, y, …] } }.
func (a *App) SaveMapCells(campaignID, ownerType, ownerID, cellsJSON string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	_, err = inTx(db, func(tx *sql.Tx) (bool, error) {
		return true, saveMapCells(tx, campaignID, ownerType, ownerID, cellsJSON)
	})
	return err
}

// PlaceMapMarker puts a location / NPC / encounter into a cell of a location's map (or moves it).
func (a *App) PlaceMapMarker(campaignID, ownerType, ownerID, refType, refID string, x, y int) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	_, err = inTx(db, func(tx *sql.Tx) (bool, error) {
		return true, placeMapMarker(tx, campaignID, ownerType, ownerID, MapMarker{RefType: refType, RefID: refID, X: x, Y: y})
	})
	return err
}

// RemoveMapMarker takes a marker off a map.
func (a *App) RemoveMapMarker(campaignID, ownerType, ownerID, refType, refID string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	_, err = inTx(db, func(tx *sql.Tx) (bool, error) {
		return true, removeMapMarker(tx, campaignID, ownerType, ownerID, refType, refID)
	})
	return err
}
