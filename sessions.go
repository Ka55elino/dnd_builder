package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Sessions of a campaign and their log (db/schema/campaigns.sql).
//
// A log event can change what it is about — "variant B": marking a quest completed sets
// the quest's status, "met the NPC" makes them known to the players… The event keeps
// { field, from, to } so deleting it puts the old value back (if nobody changed it since).
// The tables keep the current state; the events are the history.

// Session is one game night; Data: prep, secrets [{ text, revealed }], planned, recap, notes…
type Session struct {
	ID         string         `json:"id"`
	CampaignID string         `json:"campaignId"`
	Number     int            `json:"number"`
	Title      string         `json:"title"`
	PlayedOn   string         `json:"playedOn"`   // 'YYYY-MM-DD'
	IngameDate string         `json:"ingameDate"` // free text
	Status     string         `json:"status"`     // planned | active | played
	Data       map[string]any `json:"data"`
	CreatedAt  int64          `json:"createdAt"`
	UpdatedAt  int64          `json:"updatedAt"`
	Events     int            `json:"events"` // how many log entries
}

// Change is what an event did to the thing it is about.
type Change struct {
	Field string `json:"field"`           // visible | attitude | status | reputation | objective | secret
	From  any    `json:"from"`            // the value before (set by Go)
	To    any    `json:"to"`              // the value after
	Delta int    `json:"delta,omitempty"` // reputation: + / −
	Index *int   `json:"index,omitempty"` // objective / secret: which one in the list
}

// Event is one entry of a session's log.
type Event struct {
	ID         string  `json:"id"`
	SessionID  string  `json:"sessionId"`
	CampaignID string  `json:"campaignId"`
	At         int64   `json:"at"`       // unix time
	Position   int     `json:"position"` // order in the log
	Kind       string  `json:"kind"`
	RefType    string  `json:"refType"`
	RefID      string  `json:"refId"`
	RefName    string  `json:"refName"`
	Outcome    string  `json:"outcome"`
	Change     *Change `json:"change"` // nil — the event changes nothing
	Note       string  `json:"note"`
	Auto       bool    `json:"auto"` // written by the game (combat, Give Item)
	// only in an entity's history (GetRefEvents)
	SessionNumber int    `json:"sessionNumber,omitempty"`
	SessionTitle  string `json:"sessionTitle,omitempty"`
}

var sessionStatuses = map[string]bool{"planned": true, "active": true, "played": true}

// event kinds and the change each one makes by default (nil — none; "" To — the caller gives it)
var eventKinds = map[string]*Change{
	"npc_met":            {Field: "visible", To: true},
	"npc_talked":         nil,
	"npc_attitude":       {Field: "attitude"},
	"npc_status":         {Field: "status"},
	"quest_received":     {Field: "status", To: "active"},
	"quest_objective":    {Field: "objective", To: true},
	"quest_status":       {Field: "status"},
	"location_visited":   {Field: "visible", To: true},
	"faction_reputation": {Field: "reputation"},
	"faction_attitude":   {Field: "attitude"},
	"encounter_done":     nil,
	"encounter_skipped":  nil,
	"secret_revealed":    {Field: "secret", To: true},
	"item_given":         nil,
	"xp":                 nil,
	"loot":               nil,
	"rest":               nil,
	"time":               nil,
	"character":          nil,
	"note":               nil,
}

// the table of each kind of thing an event can be about
var refTables = map[string]string{
	"npc":       "campaign_npcs",
	"location":  "campaign_locations",
	"quest":     "campaign_quests",
	"faction":   "campaign_factions",
	"session":   "campaign_sessions",
	"encounter": "encounters",
}

// which fields of which thing an event may change, and how
type fieldSpec struct {
	column string // a column, or "" for an item of a list in data_json
	list   string // data_json list (objectives / secrets)
	prop   string // the item's property (done / revealed)
	kind   string // bool | text | int
	valid  map[string]bool
}

var changeFields = map[string]fieldSpec{
	"npc.visible":        {column: "visible", kind: "bool"},
	"npc.attitude":       {column: "attitude", kind: "text", valid: npcAttitudes},
	"npc.status":         {column: "status", kind: "text", valid: npcStatuses},
	"location.visible":   {column: "visible", kind: "bool"},
	"quest.status":       {column: "status", kind: "text", valid: questStatuses},
	"quest.visible":      {column: "visible", kind: "bool"},
	"quest.objective":    {list: "objectives", prop: "done", kind: "bool"},
	"faction.reputation": {column: "reputation", kind: "int"},
	"faction.attitude":   {column: "attitude", kind: "text", valid: npcAttitudes},
	"faction.visible":    {column: "visible", kind: "bool"},
	"session.secret":     {list: "secrets", prop: "revealed", kind: "bool"},
}

// ---------- reading ----------

func scanSession(scan func(...any) error) (Session, error) {
	var (
		s    Session
		data string
	)
	if err := scan(&s.ID, &s.CampaignID, &s.Number, &s.Title, &s.PlayedOn, &s.IngameDate, &s.Status, &data,
		&s.CreatedAt, &s.UpdatedAt, &s.Events); err != nil {
		return s, err
	}
	var err error
	s.Data, err = unmarshalData(data)
	return s, err
}

func getSessions(db *sql.DB, campaignID string) ([]Session, error) {
	rows, err := db.Query(Q("GetCampaignSessions"), campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		s, err := scanSession(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// getActiveSession returns the session being played now, or nil.
func getActiveSession(q querier) (*Session, error) {
	s, err := scanSession(q.QueryRow(Q("GetActiveSession")).Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func scanEvent(scan func(...any) error, extra ...any) (Event, error) {
	var (
		e      Event
		change string
		auto   int
	)
	dest := append([]any{&e.ID, &e.SessionID, &e.CampaignID, &e.At, &e.Position, &e.Kind, &e.RefType, &e.RefID,
		&e.RefName, &e.Outcome, &change, &e.Note, &auto}, extra...)
	if err := scan(dest...); err != nil {
		return e, err
	}
	e.Auto = auto == 1
	if change != "" && change != "{}" && change != "null" {
		var c Change
		if err := json.Unmarshal([]byte(change), &c); err == nil && c.Field != "" {
			e.Change = &c
		}
	}
	return e, nil
}

func getEvents(db *sql.DB, sessionID string) ([]Event, error) {
	rows, err := db.Query(Q("GetSessionEvents"), sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		e, err := scanEvent(rows.Scan)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func getRefEvents(db *sql.DB, campaignID, refType, refID string) ([]Event, error) {
	rows, err := db.Query(Q("GetRefEvents"), campaignID, refType, refID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var (
			number int
			title  string
		)
		e, err := scanEvent(rows.Scan, &number, &title)
		if err != nil {
			return nil, err
		}
		e.SessionNumber, e.SessionTitle = number, title
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---------- sessions ----------

func putSession(q querier, s Session) (string, error) {
	if err := campaignExists(q, s.CampaignID); err != nil {
		return "", err
	}
	id, err := newID(q, s.ID, "ses", "GetSessionCampaign", s.CampaignID, "session")
	if err != nil {
		return "", err
	}
	if !sessionStatuses[s.Status] {
		s.Status = "planned"
	}
	if s.Number <= 0 {
		if err := q.QueryRow(Q("NextSessionNumber"), s.CampaignID).Scan(&s.Number); err != nil {
			return "", err
		}
	}
	data, err := dataJSON(s.Data)
	if err != nil {
		return "", err
	}
	if _, err := q.Exec(Q("UpsertSession"), id, s.CampaignID, s.Number, strings.TrimSpace(s.Title),
		strings.TrimSpace(s.PlayedOn), strings.TrimSpace(s.IngameDate), s.Status, data); err != nil {
		return "", err
	}
	if s.Status == "active" { // only one session is being played at a time
		if _, err := q.Exec(Q("EndActiveSessions"), id); err != nil {
			return "", err
		}
	}
	_, err = q.Exec(Q("TouchCampaign"), s.CampaignID)
	return id, err
}

// setSessionStatus: start (active — ends any other), end (played) or plan again.
func setSessionStatus(q querier, id, status string) error {
	if !sessionStatuses[status] {
		return fmt.Errorf("unknown session status %q", status)
	}
	if _, err := q.Exec(Q("SetSessionStatus"), status, id); err != nil {
		return err
	}
	if status == "active" {
		_, err := q.Exec(Q("EndActiveSessions"), id)
		return err
	}
	return nil
}

// ---------- changes (variant B) ----------

// readField returns the current value of a field (bool / string / int).
func readField(q querier, spec fieldSpec, table, id, campaignID string, index *int) (any, error) {
	if spec.column != "" {
		var v any
		where := "id = ? AND campaign_id = ?"
		err := q.QueryRow(fmt.Sprintf("SELECT %s FROM %s WHERE %s", spec.column, table, where), id, campaignID).Scan(&v)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("not found in this campaign")
		}
		if err != nil {
			return nil, err
		}
		switch spec.kind {
		case "bool":
			return fmt.Sprint(v) == "1", nil
		case "int":
			var n int
			_, _ = fmt.Sscan(fmt.Sprint(v), &n)
			return n, nil
		}
		return fmt.Sprint(v), nil
	}
	items, _, err := readList(q, table, id, campaignID, spec.list)
	if err != nil {
		return nil, err
	}
	if index == nil || *index < 0 || *index >= len(items) {
		return nil, fmt.Errorf("no such %s item", strings.TrimSuffix(spec.list, "s"))
	}
	item, _ := items[*index].(map[string]any)
	b, _ := item[spec.prop].(bool)
	return b, nil
}

// readList: the data_json list (objectives / secrets) and the whole data object.
func readList(q querier, table, id, campaignID, list string) ([]any, map[string]any, error) {
	var raw string
	err := q.QueryRow(fmt.Sprintf("SELECT data_json FROM %s WHERE id = ? AND campaign_id = ?", table), id, campaignID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, fmt.Errorf("not found in this campaign")
	}
	if err != nil {
		return nil, nil, err
	}
	data, err := unmarshalData(raw)
	if err != nil {
		return nil, nil, err
	}
	items, _ := data[list].([]any)
	return items, data, nil
}

func writeField(q querier, spec fieldSpec, table, id, campaignID string, index *int, v any) error {
	if spec.column != "" {
		val := v
		if spec.kind == "bool" {
			val = boolInt(v == true)
		}
		_, err := q.Exec(fmt.Sprintf("UPDATE %s SET %s = ?, updated_at = strftime('%%s','now') WHERE id = ? AND campaign_id = ?",
			table, spec.column), val, id, campaignID)
		return err
	}
	items, data, err := readList(q, table, id, campaignID, spec.list)
	if err != nil {
		return err
	}
	if index == nil || *index < 0 || *index >= len(items) {
		return fmt.Errorf("no such %s item", strings.TrimSuffix(spec.list, "s"))
	}
	item, _ := items[*index].(map[string]any)
	if item == nil {
		item = map[string]any{}
	}
	item[spec.prop] = v == true
	items[*index] = item
	data[spec.list] = items
	raw, err := dataJSON(data)
	if err != nil {
		return err
	}
	_, err = q.Exec(fmt.Sprintf("UPDATE %s SET data_json = ?, updated_at = strftime('%%s','now') WHERE id = ? AND campaign_id = ?", table),
		raw, id, campaignID)
	return err
}

// normalize a value from JSON to the field's kind
func asKind(kind string, v any) (any, error) {
	switch kind {
	case "bool":
		b, ok := v.(bool)
		if !ok {
			return nil, fmt.Errorf("expected true / false")
		}
		return b, nil
	case "int":
		switch n := v.(type) {
		case float64:
			return int(n), nil
		case int:
			return n, nil
		}
		return nil, fmt.Errorf("expected a number")
	}
	s, ok := v.(string)
	if !ok || s == "" {
		return nil, fmt.Errorf("expected a value")
	}
	return s, nil
}

// applyChange sets the field and fills in c.From / c.To.
func applyChange(q querier, campaignID, refType, refID string, c *Change) error {
	spec, ok := changeFields[refType+"."+c.Field]
	if !ok {
		return fmt.Errorf("a %s's %s can't be changed by the log", refType, c.Field)
	}
	table := refTables[refType]
	from, err := readField(q, spec, table, refID, campaignID, c.Index)
	if err != nil {
		return fmt.Errorf("%s: %w", refType, err)
	}
	c.From = from
	if spec.kind == "int" && c.Delta != 0 { // reputation: + / −
		c.To = max(-10, min(10, from.(int)+c.Delta))
	} else {
		to, err := asKind(spec.kind, c.To)
		if err != nil {
			return fmt.Errorf("%s %s: %w", refType, c.Field, err)
		}
		if spec.valid != nil && !spec.valid[to.(string)] {
			return fmt.Errorf("%s %s: unknown value %q", refType, c.Field, to)
		}
		c.To = to
	}
	return writeField(q, spec, table, refID, campaignID, c.Index, c.To)
}

// revertChange puts the old value back, if the field still has the value the event set.
func revertChange(q querier, campaignID, refType, refID string, c *Change) error {
	spec, ok := changeFields[refType+"."+c.Field]
	if !ok {
		return nil
	}
	table := refTables[refType]
	cur, err := readField(q, spec, table, refID, campaignID, c.Index)
	if err != nil {
		return nil // the thing is gone — nothing to put back
	}
	if fmt.Sprint(cur) != fmt.Sprint(c.To) {
		return nil // changed again since — leave it
	}
	from, err := asKind(spec.kind, c.From)
	if err != nil {
		return nil
	}
	return writeField(q, spec, table, refID, campaignID, c.Index, from)
}

// refName: the current name of the thing (for the log, so it stays readable later)
func refName(q querier, refType, refID string) string {
	table, ok := refTables[refType]
	if !ok || refID == "" {
		return ""
	}
	col := "name"
	if refType == "session" {
		col = "title"
	}
	var n string
	_ = q.QueryRow(fmt.Sprintf("SELECT %s FROM %s WHERE id = ?", col, table), refID).Scan(&n)
	return n
}

// ---------- events ----------

// addEvent logs an event in a session and applies its change. Returns the stored event.
func addEvent(q querier, e Event, auto bool) (Event, error) {
	def, known := eventKinds[e.Kind]
	if !known {
		return e, fmt.Errorf("unknown log entry kind %q", e.Kind)
	}
	campaignID, err := ownerOf(q, "GetSessionCampaign", e.SessionID)
	if err != nil {
		return e, err
	}
	if campaignID == "" {
		return e, fmt.Errorf("session not found")
	}
	e.CampaignID = campaignID
	if e.ID == "" {
		e.ID = "evt_" + strings.TrimPrefix(newCustomID(), "custom_")
	}
	if e.At == 0 {
		e.At = time.Now().Unix()
	}
	if e.Position <= 0 {
		if err := q.QueryRow(Q("NextEventPosition"), e.SessionID).Scan(&e.Position); err != nil {
			return e, err
		}
	}
	if e.RefType != "" {
		if _, ok := refTables[e.RefType]; !ok {
			return e, fmt.Errorf("unknown log entry subject %q", e.RefType)
		}
	}
	if e.RefName == "" {
		e.RefName = refName(q, e.RefType, e.RefID)
	}
	// the change: the kind's default, with what the caller gave (to / delta / index)
	if def != nil && e.RefID != "" {
		c := Change{Field: def.Field, To: def.To}
		if e.Change != nil {
			if e.Change.To != nil {
				c.To = e.Change.To
			}
			c.Delta, c.Index = e.Change.Delta, e.Change.Index
		}
		if err := applyChange(q, campaignID, e.RefType, e.RefID, &c); err != nil {
			return e, err
		}
		e.Change = &c
	} else {
		e.Change = nil
	}
	change := "{}"
	if e.Change != nil {
		b, err := json.Marshal(e.Change)
		if err != nil {
			return e, err
		}
		change = string(b)
	}
	e.Auto = auto
	if _, err := q.Exec(Q("InsertEvent"), e.ID, e.SessionID, campaignID, e.At, e.Position, e.Kind, e.RefType, e.RefID,
		e.RefName, strings.TrimSpace(e.Outcome), change, strings.TrimSpace(e.Note), boolInt(auto)); err != nil {
		return e, err
	}
	if _, err := q.Exec(Q("TouchSession"), e.SessionID); err != nil {
		return e, err
	}
	_, err = q.Exec(Q("TouchCampaign"), campaignID)
	return e, err
}

// deleteEvent removes a log entry and undoes its change (if the value is still the one it set).
func deleteEvent(q querier, id string) error {
	e, err := scanEvent(q.QueryRow(Q("GetEvent"), id).Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if e.Change != nil {
		if err := revertChange(q, e.CampaignID, e.RefType, e.RefID, e.Change); err != nil {
			return err
		}
	}
	if _, err := q.Exec(Q("DeleteEvent"), id); err != nil {
		return err
	}
	_, err = q.Exec(Q("TouchSession"), e.SessionID)
	return err
}

// ---------- bound methods ----------

// GetCampaignSessions returns a campaign's sessions, newest first.
func (a *App) GetCampaignSessions(campaignID string) ([]Session, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getSessions(db, campaignID)
}

// GetSession returns one session.
func (a *App) GetSession(id string) (Session, error) {
	db, err := a.conn()
	if err != nil {
		return Session{}, err
	}
	s, err := scanSession(db.QueryRow(Q("GetSession"), id).Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return s, fmt.Errorf("session not found")
	}
	return s, err
}

// GetActiveSession returns the session being played now (the game's log goes there), or nil.
func (a *App) GetActiveSession() (*Session, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getActiveSession(db)
}

// SaveSession creates (without an id; the number is the next one) or updates a session. Returns the id.
func (a *App) SaveSession(sessionJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	var s Session
	if err := json.Unmarshal([]byte(sessionJSON), &s); err != nil {
		return "", err
	}
	return inTx(db, func(tx *sql.Tx) (string, error) { return putSession(tx, s) })
}

// SetSessionStatus starts a session (active — the game logs into it; any other one ends),
// ends it (played) or sets it back to planned.
func (a *App) SetSessionStatus(id, status string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	_, err = inTx(db, func(tx *sql.Tx) (bool, error) { return true, setSessionStatus(tx, id, status) })
	return err
}

// DeleteSession deletes a session and its log. What the log changed stays as it is.
func (a *App) DeleteSession(id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	_, err = inTx(db, func(tx *sql.Tx) (bool, error) {
		if _, err := tx.Exec(Q("DeleteSessionEvents"), id); err != nil {
			return false, err
		}
		_, err := tx.Exec(Q("DeleteSession"), id)
		return true, err
	})
	return err
}

// GetSessionEvents returns a session's log, in order.
func (a *App) GetSessionEvents(sessionID string) ([]Event, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getEvents(db, sessionID)
}

// GetRefEvents returns the history of one thing (refType: npc | quest | location | faction |
// encounter) across the campaign's sessions.
func (a *App) GetRefEvents(campaignID, refType, refID string) ([]Event, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getRefEvents(db, campaignID, refType, refID)
}

// AddSessionEvent logs an event and applies its change (quest → completed, NPC → met…).
func (a *App) AddSessionEvent(eventJSON string) (Event, error) {
	db, err := a.conn()
	if err != nil {
		return Event{}, err
	}
	var e Event
	if err := json.Unmarshal([]byte(eventJSON), &e); err != nil {
		return e, err
	}
	return inTx(db, func(tx *sql.Tx) (Event, error) { return addEvent(tx, e, false) })
}

// LogToActiveSession is the game's auto-log (combat, Give Item): the event goes to the
// session being played now. No active session — nothing is logged (returns "").
func (a *App) LogToActiveSession(eventJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	var e Event
	if err := json.Unmarshal([]byte(eventJSON), &e); err != nil {
		return "", err
	}
	return inTx(db, func(tx *sql.Tx) (string, error) {
		s, err := getActiveSession(tx)
		if err != nil || s == nil {
			return "", err
		}
		e.SessionID = s.ID
		// a reference outside this campaign (e.g. an encounter preset it doesn't use) is kept
		// as a name only
		if e.RefType != "" && e.RefType != "encounter" {
			if q, ok := linkTypes[e.RefType]; ok && q != "" {
				if owner, _ := ownerOf(tx, q, e.RefID); owner != s.CampaignID {
					e.RefID = ""
				}
			}
		}
		saved, err := addEvent(tx, e, true)
		return saved.ID, err
	})
}

// UpdateSessionEvent changes a log entry's note, outcome or position (not its change).
func (a *App) UpdateSessionEvent(id, note, outcome string, position int) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	_, err = db.Exec(Q("UpdateEvent"), strings.TrimSpace(note), strings.TrimSpace(outcome), position, id)
	return err
}

// DeleteSessionEvent deletes a log entry and undoes its change (if it wasn't changed again since).
func (a *App) DeleteSessionEvent(id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	_, err = inTx(db, func(tx *sql.Tx) (bool, error) { return true, deleteEvent(tx, id) })
	return err
}
