package lan

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
)

const (
	dialTimeout       = 5 * time.Second
	reconnectInterval = 2 * time.Second
	reconnectFor      = 60 * time.Second
)

// client is the player side: one connection to the DM, reconnecting on drops.
type client struct {
	m       *Manager
	addr    string // host:port
	hello   Hello
	ctx     context.Context
	cancel  context.CancelFunc
	leaving atomic.Bool // set by stop(), so the read loop doesn't try to reconnect

	// guarded by m.mu
	state    string // StateConnecting | StateConnected
	game     GameInfo
	playerID string
	players  []PlayerInfo
	peer     *peer
	// the latest "state" event sent: re-sent after a reconnect, so the DM's
	// card is current again without waiting for the next change
	lastState *Event
}

// startClient connects and waits for the DM's welcome; on success the
// connection is kept (and restored after drops) in the background.
func startClient(m *Manager, addr string, hello Hello) (*client, error) {
	ctx, cancel := context.WithCancel(context.Background())
	c := &client{m: m, addr: addr, hello: hello, ctx: ctx, cancel: cancel, state: StateConnecting}

	p, welcome, err := c.connect()
	if err != nil {
		cancel()
		return nil, err
	}
	c.attach(p, welcome)
	go c.run(p)
	return c, nil
}

// connect dials, sends hello and reads the welcome.
func (c *client) connect() (*peer, Welcome, error) {
	var welcome Welcome
	dctx, cancel := context.WithTimeout(c.ctx, dialTimeout)
	defer cancel()

	conn, _, err := websocket.Dial(dctx, "ws://"+c.addr+wsPath, nil)
	if err != nil {
		return nil, welcome, fmt.Errorf("could not reach the DM at %s — check that you're on the same Wi-Fi, "+
			"the game is running and the DM's firewall allows the app", c.addr)
	}
	conn.SetReadLimit(readLimit)

	hello := c.hello
	hello.PlayerID = c.currentPlayerID()
	data, err := encode(MsgHello, hello)
	if err == nil {
		err = conn.Write(dctx, websocket.MessageText, data)
	}
	if err != nil {
		conn.CloseNow()
		return nil, welcome, fmt.Errorf("could not send the character: %w", err)
	}

	_, data, err = conn.Read(dctx)
	if err != nil {
		conn.CloseNow()
		return nil, welcome, errString("the DM did not answer")
	}
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		conn.CloseNow()
		return nil, welcome, errString("unexpected answer from the DM")
	}
	switch env.Type {
	case MsgWelcome:
		if err := json.Unmarshal(env.Payload, &welcome); err != nil {
			conn.CloseNow()
			return nil, welcome, errString("unexpected answer from the DM")
		}
	case MsgError:
		var e ErrorMsg
		_ = json.Unmarshal(env.Payload, &e)
		conn.CloseNow()
		return nil, welcome, errors.New(e.Message)
	default:
		conn.CloseNow()
		return nil, welcome, errString("unexpected answer from the DM")
	}
	return newPeer(c.ctx, conn), welcome, nil
}

func (c *client) currentPlayerID() string {
	c.m.mu.Lock()
	defer c.m.mu.Unlock()
	return c.playerID
}

func (c *client) attach(p *peer, w Welcome) {
	c.m.mu.Lock()
	c.peer = p
	c.state = StateConnected
	c.playerID = w.PlayerID
	c.game = w.Game
	c.m.mu.Unlock()
}

// run reads messages and reconnects after unexpected drops.
func (c *client) run(p *peer) {
	for {
		err := c.readLoop(p)
		if c.leaving.Load() || c.ctx.Err() != nil {
			return // Leave() was called
		}
		if websocket.CloseStatus(err) == websocket.StatusGoingAway {
			c.m.clientGone(c, "The DM ended the game")
			return
		}
		log.Printf("[lan] connection lost: %v", err)

		c.m.mu.Lock()
		c.state = StateConnecting
		c.peer = nil
		c.m.mu.Unlock()
		c.m.notify()

		p = c.reconnect()
		if p == nil {
			if c.ctx.Err() == nil {
				c.m.clientGone(c, "Lost connection to the DM")
			}
			return
		}
		c.m.mu.Lock()
		last := c.lastState
		c.m.mu.Unlock()
		if last != nil {
			_ = p.Send(MsgEvent, *last) // the seat was new: bring the DM's card up to date
		}
		c.m.notify()
	}
}

func (c *client) reconnect() *peer {
	deadline := time.Now().Add(reconnectFor)
	for time.Now().Before(deadline) {
		select {
		case <-c.ctx.Done():
			return nil
		case <-time.After(reconnectInterval):
		}
		p, w, err := c.connect()
		if err == nil {
			c.attach(p, w)
			return p
		}
	}
	return nil
}

func (c *client) readLoop(p *peer) error {
	defer p.cancel()
	for {
		env, err := p.Read(p.ctx)
		if err != nil {
			return err
		}
		switch env.Type {
		case MsgLobby:
			var l Lobby
			if json.Unmarshal(env.Payload, &l) == nil {
				c.m.mu.Lock()
				c.players = l.Players
				c.game.Players = countOnline(l.Players)
				c.m.mu.Unlock()
				c.m.notify()
			}
		case MsgEvent:
			var ev Event
			if json.Unmarshal(env.Payload, &ev) == nil && ev.Kind != "" {
				c.m.emit(EventGameEvent, ev)
			}
		}
	}
}

func (c *client) send(ev Event) error {
	c.m.mu.Lock()
	p := c.peer
	c.m.mu.Unlock()
	if p == nil {
		return errString("not connected to the DM")
	}
	ev.From, ev.To = "", ""
	if ev.Kind == EventKindState {
		c.m.mu.Lock()
		keep := ev
		c.lastState = &keep
		c.m.mu.Unlock()
	}
	return p.Send(MsgEvent, ev)
}

func (c *client) stop() {
	c.leaving.Store(true)
	c.m.mu.Lock()
	p := c.peer
	c.m.mu.Unlock()
	if p != nil {
		p.Close(websocket.StatusNormalClosure, "player left")
	}
	c.cancel()
}

func countOnline(list []PlayerInfo) int {
	n := 0
	for _, p := range list {
		if p.Online {
			n++
		}
	}
	return n
}
