// Package lan is the local-network game layer: the DM hosts a WebSocket server
// announced over mDNS, players discover it (or type its address) and join
// with a character snapshot; after that both sides exchange events.
package lan

import "encoding/json"

const (
	// ServiceType is the mDNS service the game is announced under.
	ServiceType = "_dndbuilder._tcp"
	// ServiceDomain is the mDNS domain.
	ServiceDomain = "local."
	// ProtocolVersion is bumped on incompatible protocol changes.
	// 2: Hello carries the app version, and the DM refuses a different one.
	ProtocolVersion = 2
	// DefaultPort is tried first (then the next few), so the firewall
	// rule the DM allowed once keeps working.
	DefaultPort = 47800
	// portAttempts is how many ports after DefaultPort are tried.
	portAttempts = 10
	// wsPath is the WebSocket endpoint on the host.
	wsPath = "/ws"
	// readLimit is the maximum message size (character snapshots can be large).
	readLimit = 8 << 20
)

// Message types.
const (
	MsgHello   = "hello"   // player → DM: first message, character snapshot
	MsgWelcome = "welcome" // DM → player: accepted, player id and game info
	MsgLobby   = "lobby"   // DM → all: current player list
	MsgEvent   = "event"   // both ways: game events
	MsgError   = "error"   // DM → player: request rejected
)

// EventKindState is the game event a player sends with its current character
// state and sheet summary ({"state": {...}, "summary": {...}}); the host keeps the
// latest ones in the snapshot, and the player's client re-sends it after a reconnect.
const EventKindState = "state"

// Envelope is the wire format of every message.
type Envelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

func encode(msgType string, payload any) ([]byte, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Envelope{Type: msgType, Payload: raw})
}

// Snapshot is a character sent to the DM once, on join.
type Snapshot struct {
	Build map[string]any `json:"build"`
	State map[string]any `json:"state,omitempty"`
	// Summary is the sheet as the player's app computed it (frontend rules/summary.js),
	// kept from the player's latest "state" event; the DM shows it as is.
	Summary map[string]any `json:"summary,omitempty"`
}

// PlayerInfo is a lobby row.
type PlayerInfo struct {
	ID          string `json:"id"`
	CharacterID string `json:"characterId"`
	Name        string `json:"name"`
	ClassName   string `json:"className"`
	Level       int    `json:"level"`
	Portrait    string `json:"portrait"`
	Online      bool   `json:"online"`
}

// GameInfo describes a hosted game (also what discovery returns).
type GameInfo struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Host     string `json:"host"` // IP address
	Port     int    `json:"port"`
	Players  int    `json:"players"`
	Protocol int    `json:"protocol"`
	Version  string `json:"version"` // the DM's app version ("" — unknown)
}

// Hello is the first message from a player.
type Hello struct {
	Protocol   int        `json:"protocol"`
	AppVersion string     `json:"appVersion"`         // the player's app version (APP_VERSION)
	PlayerID   string     `json:"playerId,omitempty"` // set on reconnect to keep the seat
	Player     PlayerInfo `json:"player"`
	Character  Snapshot   `json:"character"`
}

// Welcome is the DM's answer to Hello.
type Welcome struct {
	PlayerID string   `json:"playerId"`
	Game     GameInfo `json:"game"`
}

// Lobby is the player list broadcast by the DM.
type Lobby struct {
	Players []PlayerInfo `json:"players"`
}

// Event is a game event. From is set by the DM's server (never trusted from
// the sender); To is empty for "everyone" (DM → players) or ignored (player → DM).
type Event struct {
	Kind string          `json:"kind"`
	From string          `json:"from,omitempty"`
	To   string          `json:"to,omitempty"`
	Data json.RawMessage `json:"data,omitempty"`
}

// ErrorMsg is sent by the DM before closing a rejected connection.
type ErrorMsg struct {
	Message string `json:"message"`
}
