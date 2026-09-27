package lan

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/grandcat/zeroconf"
)

// host is the DM side: WebSocket server + mDNS announcement.
type host struct {
	m      *Manager
	info   GameInfo
	ln     net.Listener
	srv    *http.Server
	mdns   *zeroconf.Server
	ctx    context.Context
	cancel context.CancelFunc

	mu      sync.Mutex
	players map[string]*seat
	order   []string // join order, for a stable lobby list
}

// seat is a connected player; it is removed when the connection closes.
type seat struct {
	info PlayerInfo
	snap Snapshot
	peer *peer
}

func startHost(m *Manager, name string) (*host, error) {
	ln, err := listen()
	if err != nil {
		return nil, fmt.Errorf("could not start the server: %w", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port

	ctx, cancel := context.WithCancel(context.Background())
	h := &host{
		m: m,
		info: GameInfo{
			ID:       newID(),
			Name:     name,
			Host:     LocalIP(),
			Port:     port,
			Protocol: ProtocolVersion,
		},
		ln:      ln,
		ctx:     ctx,
		cancel:  cancel,
		players: map[string]*seat{},
	}

	mux := http.NewServeMux()
	mux.HandleFunc(wsPath, h.handleWS)
	h.srv = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := h.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("[lan] server: %v", err)
		}
	}()

	// The instance name is the game id (names with spaces/unicode get mangled
	// by some mDNS stacks); the human name travels in TXT.
	h.mdns, err = zeroconf.Register(h.info.ID, ServiceType, ServiceDomain, port, h.txt(), nil)
	if err != nil {
		// not fatal: players can still connect by address
		log.Printf("[lan] mDNS announce failed: %v", err)
	}
	log.Printf("[lan] hosting %q on %s:%d", name, h.info.Host, port)
	return h, nil
}

// listen binds DefaultPort or one of the next few, then any free port.
func listen() (net.Listener, error) {
	for p := DefaultPort; p < DefaultPort+portAttempts; p++ {
		if ln, err := net.Listen("tcp4", ":"+strconv.Itoa(p)); err == nil {
			return ln, nil
		}
	}
	return net.Listen("tcp4", ":0")
}

func (h *host) txt() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return []string{
		"name=" + h.info.Name,
		"id=" + h.info.ID,
		"ip=" + LocalIP(), // the address the DM sees in the header; preferred over A records (VPN, Docker…)
		"v=" + strconv.Itoa(ProtocolVersion),
		"players=" + strconv.Itoa(h.onlineCount()),
	}
}

func (h *host) onlineCount() int {
	n := 0
	for _, s := range h.players {
		if s.peer != nil {
			n++
		}
	}
	return n
}

func (h *host) handleWS(w http.ResponseWriter, r *http.Request) {
	// Clients are the Go side of the app, not browsers — no Origin to check.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	conn.SetReadLimit(readLimit)

	hello, err := readHello(h.ctx, conn)
	if err != nil {
		reject(conn, err.Error())
		return
	}

	p := newPeer(h.ctx, conn)
	s := h.seatFor(hello, p)
	_ = p.Send(MsgWelcome, Welcome{PlayerID: s.info.ID, Game: h.gameInfo()})
	h.changed()

	h.readLoop(s, p)

	// disconnected — the player leaves the lobby (a reconnect joins again
	// with the same id, see seatFor)
	h.mu.Lock()
	if s.peer == p {
		h.removeSeat(s.info.ID)
	}
	h.mu.Unlock()
	p.cancel()
	h.changed()
}

func readHello(ctx context.Context, conn *websocket.Conn) (Hello, error) {
	var hello Hello
	ctx, cancel := context.WithTimeout(ctx, helloTimeout)
	defer cancel()
	_, data, err := conn.Read(ctx)
	if err != nil {
		return hello, err
	}
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil || env.Type != MsgHello {
		return hello, errString("expected hello")
	}
	if err := json.Unmarshal(env.Payload, &hello); err != nil {
		return hello, errString("bad hello")
	}
	if hello.Protocol != ProtocolVersion {
		return hello, fmt.Errorf("app version mismatch (DM protocol %d, yours %d) — update the app", ProtocolVersion, hello.Protocol)
	}
	return hello, nil
}

func reject(conn *websocket.Conn, msg string) {
	if data, err := encode(MsgError, ErrorMsg{Message: msg}); err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = conn.Write(ctx, websocket.MessageText, data)
		cancel()
	}
	_ = conn.Close(websocket.StatusPolicyViolation, msg)
}

// removeSeat drops a player from the game (h.mu held).
func (h *host) removeSeat(id string) {
	delete(h.players, id)
	for i, x := range h.order {
		if x == id {
			h.order = append(h.order[:i], h.order[i+1:]...)
			break
		}
	}
}

// seatFor returns the player's seat: the current one if the player is still
// connected (a new connection replaces the old), a new one otherwise.
func (h *host) seatFor(hello Hello, p *peer) *seat {
	h.mu.Lock()
	defer h.mu.Unlock()

	s, ok := h.players[hello.PlayerID]
	if !ok {
		s = &seat{}
		s.info.ID = hello.PlayerID // reconnect: keep the id the player had
		if s.info.ID == "" || len(s.info.ID) > 32 {
			s.info.ID = newID()
		}
		h.players[s.info.ID] = s
		h.order = append(h.order, s.info.ID)
	} else if old := s.peer; old != nil {
		go old.Close(websocket.StatusNormalClosure, "replaced by a new connection")
	}
	id := s.info.ID
	s.info = hello.Player
	s.info.ID = id
	s.info.Online = true
	s.snap = hello.Character
	s.peer = p
	return s
}

func (h *host) readLoop(s *seat, p *peer) {
	for {
		env, err := p.Read(p.ctx)
		if err != nil {
			return
		}
		switch env.Type {
		case MsgEvent:
			var ev Event
			if json.Unmarshal(env.Payload, &ev) != nil || ev.Kind == "" {
				continue
			}
			ev.From = s.info.ID // never trust the sender
			ev.To = ""
			if ev.Kind == EventKindState {
				h.updateState(s, ev.Data)
			}
			h.m.emit(EventGameEvent, ev)
		}
	}
}

// updateState keeps the player's latest state in the snapshot, so the DM's
// screen shows current Hit Points even when it is opened later.
func (h *host) updateState(s *seat, data json.RawMessage) {
	var body struct {
		State map[string]any `json:"state"`
	}
	if json.Unmarshal(data, &body) != nil || body.State == nil {
		return
	}
	h.mu.Lock()
	s.snap.State = body.State
	h.mu.Unlock()
}

// changed rebroadcasts the lobby, updates the mDNS player count and the UI.
func (h *host) changed() {
	lobby := Lobby{Players: h.playerList()}
	h.mu.Lock()
	for _, s := range h.players {
		if s.peer != nil {
			_ = s.peer.Send(MsgLobby, lobby)
		}
	}
	h.mu.Unlock()
	if h.mdns != nil {
		h.mdns.SetText(h.txt())
	}
	h.m.notify()
}

func (h *host) playerList() []PlayerInfo {
	h.mu.Lock()
	defer h.mu.Unlock()
	list := make([]PlayerInfo, 0, len(h.order))
	for _, id := range h.order {
		list = append(list, h.players[id].info)
	}
	return list
}

func (h *host) gameInfo() GameInfo {
	h.mu.Lock()
	defer h.mu.Unlock()
	info := h.info
	info.Players = h.onlineCount()
	return info
}

// send delivers an event to one player (to != "") or to everyone.
func (h *host) send(ev Event) error {
	ev.From = ""
	h.mu.Lock()
	defer h.mu.Unlock()
	if ev.To != "" {
		s, ok := h.players[ev.To]
		if !ok || s.peer == nil {
			return errString("player is not connected")
		}
		return s.peer.Send(MsgEvent, ev)
	}
	for _, s := range h.players {
		if s.peer != nil {
			_ = s.peer.Send(MsgEvent, ev)
		}
	}
	return nil
}

func (h *host) snapshot(playerID string) (Snapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	s, ok := h.players[playerID]
	if !ok {
		return Snapshot{}, errString("no such player")
	}
	return s.snap, nil
}

// stop ends the game: players get "going away" and won't try to reconnect.
func (h *host) stop() {
	if h.mdns != nil {
		h.mdns.Shutdown()
	}
	// close handshakes in parallel, then tear everything down
	var wg sync.WaitGroup
	h.mu.Lock()
	for _, s := range h.players {
		if p := s.peer; p != nil {
			wg.Add(1)
			go func() {
				defer wg.Done()
				p.Close(websocket.StatusGoingAway, "the DM ended the game")
			}()
		}
	}
	h.mu.Unlock()
	wg.Wait()
	h.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = h.srv.Shutdown(ctx)
}
