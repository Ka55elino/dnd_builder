package lan

import (
	"context"
	"encoding/json"
	"time"

	"github.com/coder/websocket"
)

const (
	writeTimeout  = 10 * time.Second
	pingInterval  = 15 * time.Second
	pingTimeout   = 5 * time.Second
	helloTimeout  = 10 * time.Second
	sendQueueSize = 64
)

// peer is one WebSocket connection with a single writer goroutine
// (coder/websocket allows one concurrent writer) and a heartbeat.
type peer struct {
	conn   *websocket.Conn
	send   chan []byte
	ctx    context.Context
	cancel context.CancelFunc
}

func newPeer(parent context.Context, conn *websocket.Conn) *peer {
	conn.SetReadLimit(readLimit)
	ctx, cancel := context.WithCancel(parent)
	p := &peer{conn: conn, send: make(chan []byte, sendQueueSize), ctx: ctx, cancel: cancel}
	go p.writeLoop()
	go p.pingLoop()
	return p
}

func (p *peer) writeLoop() {
	for {
		select {
		case <-p.ctx.Done():
			return
		case msg := <-p.send:
			ctx, cancel := context.WithTimeout(p.ctx, writeTimeout)
			err := p.conn.Write(ctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				p.conn.CloseNow()
				p.cancel()
				return
			}
		}
	}
}

// pingLoop drops connections that stopped answering (Wi-Fi gone, laptop asleep).
// Ping needs a concurrent Read, which the owner's read loop provides.
func (p *peer) pingLoop() {
	t := time.NewTicker(pingInterval)
	defer t.Stop()
	for {
		select {
		case <-p.ctx.Done():
			return
		case <-t.C:
			ctx, cancel := context.WithTimeout(p.ctx, pingTimeout)
			err := p.conn.Ping(ctx)
			cancel()
			if err != nil {
				p.conn.CloseNow()
				p.cancel()
				return
			}
		}
	}
}

// Send queues a message; it never blocks (a stuck peer gets disconnected).
func (p *peer) Send(msgType string, payload any) error {
	data, err := encode(msgType, payload)
	if err != nil {
		return err
	}
	select {
	case p.send <- data:
		return nil
	case <-p.ctx.Done():
		return errString("connection closed")
	default:
		p.conn.CloseNow()
		p.cancel()
		return errString("connection is too slow, dropped")
	}
}

// Read blocks until the next message.
func (p *peer) Read(ctx context.Context) (Envelope, error) {
	var env Envelope
	_, data, err := p.conn.Read(ctx)
	if err != nil {
		return env, err
	}
	err = json.Unmarshal(data, &env)
	return env, err
}

// Close closes the connection with a status and reason. The context is
// cancelled only afterwards: coder/websocket kills the connection when the
// read context is cancelled, and the reason would never reach the other side.
func (p *peer) Close(code websocket.StatusCode, reason string) {
	_ = p.conn.Close(code, reason)
	p.cancel()
}
