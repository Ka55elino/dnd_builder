package lan

import (
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"
)

type rec struct {
	mu  sync.Mutex
	evs []string
}

func (r *rec) emit(name string, data any) {
	b, _ := json.Marshal(data)
	r.mu.Lock()
	r.evs = append(r.evs, name+" "+string(b))
	r.mu.Unlock()
}
func (r *rec) has(sub string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range r.evs {
		if contains(e, sub) {
			return true
		}
	}
	return false
}
func contains(a, b string) bool {
	return len(b) == 0 || (len(a) >= len(b) && (a[:len(b)] == b || contains(a[1:], b)))
}

func wait(t *testing.T, what string, f func() bool) {
	for i := 0; i < 100; i++ {
		if f() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("timeout: %s", what)
}

func TestE2E(t *testing.T) {
	hr, pr := &rec{}, &rec{}
	dm := NewManager(hr.emit)
	pl := NewManager(pr.emit)

	st, err := dm.Host("Lost Mine")
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("host status: %+v game=%+v", st, *st.Game)
	addr := fmt.Sprintf("127.0.0.1:%d", st.Game.Port)

	ps, err := pl.Join(addr, PlayerInfo{CharacterID: "c1", Name: "Bruenor", ClassName: "Fighter", Level: 3},
		Snapshot{Build: map[string]any{"id": "c1", "name": "Bruenor"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("player status: %+v", ps)
	if ps.Role != RolePlayer || ps.State != StateConnected || ps.PlayerID == "" {
		t.Fatal("bad player status")
	}
	wait(t, "lobby at player", func() bool { return len(pl.Status().Players) == 1 })
	wait(t, "lobby at host", func() bool { return len(dm.Status().Players) == 1 })
	pid := dm.Status().Players[0].ID

	snap, err := dm.PlayerCharacter(pid)
	if err != nil || snap.Build["name"] != "Bruenor" {
		t.Fatal("snapshot", err, snap)
	}

	// player → DM
	if err := pl.Send("roll", "", json.RawMessage(`{"d":20,"v":17}`)); err != nil {
		t.Fatal(err)
	}
	wait(t, "event at DM", func() bool { return hr.has(`net:event {"kind":"roll","from":"` + pid + `"`) })
	// player's state updates are kept in the snapshot
	if err := pl.Send(EventKindState, "", json.RawMessage(`{"state":{"hpLost":4}}`)); err != nil {
		t.Fatal(err)
	}
	wait(t, "state kept", func() bool {
		s, _ := dm.PlayerCharacter(pid)
		return s.State != nil && s.State["hpLost"] == float64(4)
	})

	// DM → player (direct and broadcast)
	if err := dm.Send("hp", pid, json.RawMessage(`{"hp":-5}`)); err != nil {
		t.Fatal(err)
	}
	if err := dm.Send("start", "", nil); err != nil {
		t.Fatal(err)
	}
	wait(t, "event at player", func() bool { return pr.has(`net:event {"kind":"hp"`) && pr.has(`net:event {"kind":"start"`) })

	// conflicts
	if _, err := dm.Join(addr, PlayerInfo{Name: "x"}, Snapshot{}); err == nil {
		t.Fatal("host could join")
	}
	if _, err := pl.Host("x"); err == nil {
		t.Fatal("player could host")
	}
	// bad address
	pl2 := NewManager(nil)
	if _, err := pl2.Join("127.0.0.1:1", PlayerInfo{Name: "x"}, Snapshot{}); err == nil {
		t.Fatal("joined nothing")
	} else {
		t.Log("bad addr:", err)
	}

	// leave removes the card; joining again adds it back
	pl.Leave()
	wait(t, "removed at host", func() bool { return len(dm.Status().Players) == 0 })

	if _, err := pl.Join(addr, PlayerInfo{Name: "Bruenor"}, Snapshot{}); err != nil {
		t.Fatal(err)
	}
	wait(t, "rejoined", func() bool { return len(dm.Status().Players) == 1 })

	// DM ends the game → player gets the reason, no reconnect loop
	dm.StopHost()
	wait(t, "player notified", func() bool { s := pl.Status(); return s.Role == RoleNone && s.Error != "" })
	t.Log("player after stop:", pl.Status().Error)
	if dm.Status().Role != RoleNone {
		t.Fatal("host still hosting")
	}

	// can host again on the same port
	st2, err := dm.Host("Again")
	if err != nil {
		t.Fatal(err)
	}
	t.Log("port again:", st2.Game.Port)
	dm.Close()
	pl.Close()
}

func TestReconnect(t *testing.T) {
	dm := NewManager(nil)
	pl := NewManager(nil)
	st, _ := dm.Host("R")
	addr := fmt.Sprintf("127.0.0.1:%d", st.Game.Port)
	if _, err := pl.Join(addr, PlayerInfo{Name: "A"}, Snapshot{}); err != nil {
		t.Fatal(err)
	}
	wait(t, "lobby", func() bool { return len(dm.Status().Players) == 1 })
	id := pl.Status().PlayerID
	// kill the player's socket from underneath
	pl.mu.Lock()
	old := pl.client.peer
	pl.mu.Unlock()
	old.conn.CloseNow()
	wait(t, "reconnected", func() bool {
		pl.mu.Lock()
		np := pl.client.peer
		pl.mu.Unlock()
		s := pl.Status()
		d := dm.Status().Players
		return np != nil && np != old && s.State == StateConnected && s.PlayerID == id && len(d) == 1 && d[0].Online
	})
	t.Log("reconnected with same id", id)
	dm.Close()
	pl.Close()
}

func TestNormalize(t *testing.T) {
	for in, want := range map[string]string{"192.168.1.5": "192.168.1.5:47800", " 10.0.0.2:5000 ": "10.0.0.2:5000", "ws://1.2.3.4:9/ws": "1.2.3.4:9"} {
		if got, _ := normalizeAddress(in); got != want {
			t.Errorf("%q → %q, want %q", in, got, want)
		}
	}
	t.Log("LocalIP:", LocalIP())
}
