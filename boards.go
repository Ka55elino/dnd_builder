package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// The campaign board (Overview): a graph of locations (nested — a city holds its inn) and
// quests. What is drawn comes from the campaign itself:
//   quest → location  — the quest's route: quest.data.route = [{ locationId, label, objective }]
//                       (objective — the index of the quest objective that step completes)
//   quest → quest     — campaign_links kind "unlocks" (note — the condition: "if Vesk is spared")
// The board only keeps where things are drawn (campaign_board_nodes).

// Board is a campaign's diagram with the saved positions of its nodes.
type Board struct {
	ID         string         `json:"id"`
	CampaignID string         `json:"campaignId"`
	Name       string         `json:"name"`
	Data       map[string]any `json:"data"`
	Nodes      []BoardNode    `json:"nodes"`
}

// BoardNode is where a thing sits; W / H — the size of a group node (nil for others).
type BoardNode struct {
	RefType string   `json:"refType"` // location | quest
	RefID   string   `json:"refId"`
	X       float64  `json:"x"`
	Y       float64  `json:"y"`
	W       *float64 `json:"w"`
	H       *float64 `json:"h"`
}

var boardRefTypes = map[string]bool{"location": true, "quest": true}

// getBoard returns the campaign's board, creating it on first use.
func getBoard(q querier, campaignID string) (Board, error) {
	b := Board{CampaignID: campaignID, Nodes: []BoardNode{}}
	var data string
	err := q.QueryRow(Q("GetCampaignBoard"), campaignID).Scan(&b.ID, &b.CampaignID, &b.Name, &data)
	if errors.Is(err, sql.ErrNoRows) {
		if err := campaignExists(q, campaignID); err != nil {
			return b, err
		}
		b.ID = "brd_" + strings.TrimPrefix(newCustomID(), "custom_")
		b.Name = "Campaign map"
		b.Data = map[string]any{}
		_, err = q.Exec(Q("InsertBoard"), b.ID, campaignID, b.Name)
		return b, err
	}
	if err != nil {
		return b, err
	}
	if b.Data, err = unmarshalData(data); err != nil {
		return b, err
	}
	rows, err := q.Query(Q("GetBoardNodes"), b.ID)
	if err != nil {
		return b, err
	}
	defer rows.Close()
	for rows.Next() {
		var (
			n    BoardNode
			w, h sql.NullFloat64
		)
		if err := rows.Scan(&n.RefType, &n.RefID, &n.X, &n.Y, &w, &h); err != nil {
			return b, err
		}
		if w.Valid {
			n.W = &w.Float64
		}
		if h.Valid {
			n.H = &h.Float64
		}
		b.Nodes = append(b.Nodes, n)
	}
	return b, rows.Err()
}

// saveBoardNodes stores the positions of the given nodes (the others keep theirs).
func saveBoardNodes(q querier, boardID string, nodes []BoardNode) error {
	campaignID, err := ownerOf(q, "GetBoardCampaign", boardID)
	if err != nil {
		return err
	}
	if campaignID == "" {
		return fmt.Errorf("board not found")
	}
	for _, n := range nodes {
		if !boardRefTypes[n.RefType] || n.RefID == "" {
			return fmt.Errorf("unknown board node %s:%s", n.RefType, n.RefID)
		}
		var w, h any
		if n.W != nil {
			w = *n.W
		}
		if n.H != nil {
			h = *n.H
		}
		if _, err := q.Exec(Q("UpsertBoardNode"), boardID, n.RefType, n.RefID, n.X, n.Y, w, h); err != nil {
			return err
		}
	}
	_, err = q.Exec(Q("TouchBoard"), boardID)
	return err
}

// dropFromRoutes removes a deleted location from every quest route of the campaign.
func dropFromRoutes(q querier, campaignID, locationID string) error {
	rows, err := q.Query(Q("GetQuestRoutesWith"), campaignID, locationID)
	if err != nil {
		return err
	}
	type row struct{ id, data string }
	var list []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.data); err != nil {
			rows.Close()
			return err
		}
		list = append(list, r)
	}
	rows.Close()
	for _, r := range list {
		data, err := unmarshalData(r.data)
		if err != nil {
			return err
		}
		route, _ := data["route"].([]any)
		kept := []any{}
		for _, step := range route {
			if m, _ := step.(map[string]any); m != nil && m["locationId"] == locationID {
				continue
			}
			kept = append(kept, step)
		}
		if len(kept) == len(route) {
			continue // the id only appeared in some text
		}
		data["route"] = kept
		raw, err := json.Marshal(data)
		if err != nil {
			return err
		}
		if _, err := q.Exec(Q("SetQuestData"), string(raw), r.id); err != nil {
			return err
		}
	}
	return nil
}

// ---------- bound methods ----------

// GetCampaignBoard returns the campaign's board with the saved node positions.
func (a *App) GetCampaignBoard(campaignID string) (Board, error) {
	db, err := a.conn()
	if err != nil {
		return Board{}, err
	}
	return inTx(db, func(tx *sql.Tx) (Board, error) { return getBoard(tx, campaignID) })
}

// SaveBoardNodes stores node positions: [{ refType, refId, x, y, w?, h? }].
func (a *App) SaveBoardNodes(boardID, nodesJSON string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	var nodes []BoardNode
	if err := json.Unmarshal([]byte(nodesJSON), &nodes); err != nil {
		return err
	}
	_, err = inTx(db, func(tx *sql.Tx) (bool, error) { return true, saveBoardNodes(tx, boardID, nodes) })
	return err
}

// ResetBoardLayout forgets every position: the board lays itself out again.
func (a *App) ResetBoardLayout(boardID string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(Q("ClearBoardNodes"), boardID)
	return err
}

// GetPartyLocation returns where the party is: the latest "location visited" in the logs ("" if none).
func (a *App) GetPartyLocation(campaignID string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	var id string
	err = db.QueryRow(Q("GetPartyLocation"), campaignID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return id, err
}
