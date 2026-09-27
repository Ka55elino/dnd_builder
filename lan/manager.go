package lan

import (
	"encoding/json"
	"strings"
	"sync"
	"time"
)

// Events emitted to the frontend.
const (
	EventStatus    = "net:status" // Status
	EventGames     = "net:games"  // GamesList
	EventGameEvent = "net:event"  // Event
)

// Connection states.
const (
	StateDisconnected = "disconnected"
	StateConnecting   = "connecting"
	StateConnected    = "connected"
)

// Roles.
const (
	RoleNone   = ""
	RoleHost   = "host"
	RolePlayer = "player"
)

const ipRefresh = 10 * time.Second

// Status is the whole network state shown in the UI (header, game/join screens).
type Status struct {
	Role        string       `json:"role"`
	State       string       `json:"state"`
	LocalIP     string       `json:"localIp"`
	Game        *GameInfo    `json:"game"`
	PlayerID    string       `json:"playerId"`    // player: own id in the game
	CharacterID string       `json:"characterId"` // player: the character joined with
	Players     []PlayerInfo `json:"players"`
	Error       string       `json:"error"` // why the last session ended, if not by the user
}

// Manager owns the single network role of the app: host, player or nothing.
type Manager struct {
	emitFn func(name string, data any)

	mu      sync.Mutex
	host    *host
	client  *client
	disc    *discovery
	localIP string
	lastErr string
	done    chan struct{}
}

// NewManager creates the manager; emit sends an event to the frontend.
func NewManager(emit func(name string, data any)) *Manager {
	m := &Manager{emitFn: emit, localIP: LocalIP(), done: make(chan struct{})}
	go m.watchIP()
	return m
}

func (m *Manager) emit(name string, data any) {
	if m.emitFn != nil {
		m.emitFn(name, data)
	}
}

// watchIP keeps the header's IP current when the network changes.
func (m *Manager) watchIP() {
	t := time.NewTicker(ipRefresh)
	defer t.Stop()
	for {
		select {
		case <-m.done:
			return
		case <-t.C:
			ip := LocalIP()
			m.mu.Lock()
			changed := ip != m.localIP
			m.localIP = ip
			m.mu.Unlock()
			if changed {
				m.notify()
			}
		}
	}
}

// Status returns the current state.
func (m *Manager) Status() Status {
	m.mu.Lock()
	h, c := m.host, m.client
	st := Status{Role: RoleNone, State: StateDisconnected, LocalIP: m.localIP, Error: m.lastErr, Players: []PlayerInfo{}}
	if c != nil {
		st.Role = RolePlayer
		st.State = c.state
		g := c.game
		st.Game = &g
		st.PlayerID = c.playerID
		st.CharacterID = c.hello.Player.CharacterID
		if c.players != nil {
			st.Players = c.players
		}
	}
	m.mu.Unlock()

	if h != nil { // host methods take their own lock
		st.Role = RoleHost
		st.State = StateConnected
		g := h.gameInfo()
		g.Host = st.LocalIP
		st.Game = &g
		st.Players = h.playerList()
	}
	return st
}

func (m *Manager) notify() { m.emit(EventStatus, m.Status()) }

// Host starts a game with the given name (DM).
func (m *Manager) Host(name string) (Status, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return m.Status(), errString("enter a game name")
	}
	m.mu.Lock()
	if m.client != nil {
		m.mu.Unlock()
		return m.Status(), errString("you are in a game as a player — leave it first")
	}
	if m.host != nil {
		m.mu.Unlock()
		return m.Status(), errString("a game is already running")
	}
	m.mu.Unlock()

	h, err := startHost(m, name)
	if err != nil {
		return m.Status(), err
	}
	m.mu.Lock()
	m.host = h
	m.lastErr = ""
	m.mu.Unlock()
	m.notify()
	return m.Status(), nil
}

// StopHost ends the hosted game.
func (m *Manager) StopHost() {
	m.mu.Lock()
	h := m.host
	m.host = nil
	m.mu.Unlock()
	if h != nil {
		h.stop()
		m.notify()
	}
}

// StartDiscovery starts looking for games on the network (restarts if running).
func (m *Manager) StartDiscovery() {
	m.mu.Lock()
	if m.disc != nil {
		m.disc.stop()
	}
	m.disc = startDiscovery(m)
	m.mu.Unlock()
}

// StopDiscovery stops looking for games.
func (m *Manager) StopDiscovery() {
	m.mu.Lock()
	if m.disc != nil {
		m.disc.stop()
		m.disc = nil
	}
	m.mu.Unlock()
}

// Join connects to a DM at address ("ip" or "ip:port") with a character.
func (m *Manager) Join(address string, player PlayerInfo, snap Snapshot) (Status, error) {
	addr, err := normalizeAddress(address)
	if err != nil {
		return m.Status(), err
	}
	m.mu.Lock()
	if m.host != nil {
		m.mu.Unlock()
		return m.Status(), errString("you are hosting a game — stop it first")
	}
	if m.client != nil {
		m.mu.Unlock()
		return m.Status(), errString("already in a game — leave it first")
	}
	m.mu.Unlock()

	player.Online = true
	c, err := startClient(m, addr, Hello{Protocol: ProtocolVersion, Player: player, Character: snap})
	if err != nil {
		return m.Status(), err
	}
	m.mu.Lock()
	m.client = c
	m.lastErr = ""
	m.mu.Unlock()
	m.notify()
	return m.Status(), nil
}

// Leave disconnects from the DM.
func (m *Manager) Leave() {
	m.mu.Lock()
	c := m.client
	m.client = nil
	m.mu.Unlock()
	if c != nil {
		c.stop()
		m.notify()
	}
}

// clientGone is called when the connection ended on its own (DM stopped, network lost).
func (m *Manager) clientGone(c *client, reason string) {
	m.mu.Lock()
	if m.client != c {
		m.mu.Unlock()
		return
	}
	m.client = nil
	m.lastErr = reason
	m.mu.Unlock()
	c.cancel()
	m.notify()
}

// Send sends a game event: the DM to a player (to = player id) or everyone
// (to = ""); a player always to the DM.
func (m *Manager) Send(kind, to string, data json.RawMessage) error {
	if strings.TrimSpace(kind) == "" {
		return errString("event kind is empty")
	}
	m.mu.Lock()
	h, c := m.host, m.client
	m.mu.Unlock()
	ev := Event{Kind: kind, To: to, Data: data}
	switch {
	case h != nil:
		return h.send(ev)
	case c != nil:
		return c.send(ev)
	}
	return errString("not in a game")
}

// PlayerCharacter returns the snapshot a player joined with (DM only).
func (m *Manager) PlayerCharacter(playerID string) (Snapshot, error) {
	m.mu.Lock()
	h := m.host
	m.mu.Unlock()
	if h == nil {
		return Snapshot{}, errString("not hosting a game")
	}
	return h.snapshot(playerID)
}

// Close shuts everything down (app exit).
func (m *Manager) Close() {
	m.StopDiscovery()
	m.StopHost()
	m.Leave()
	close(m.done)
}
