package main

import (
	"encoding/json"
	"log"
	"sync"

	"dnd-builder-v3/lan"
)

// hpState is a fake player's character state: the real one from the
// snapshot, with Hit Points changed by the DM's "hp" events (same rules as
// CharacterState in the app, except that the maximum is unknown here, so lost
// HP is not capped).
type hpState struct {
	mu    sync.Mutex
	state map[string]any
}

func newHPState(initial map[string]any) *hpState {
	st := map[string]any{}
	for k, v := range initial {
		st[k] = v
	}
	return &hpState{state: st}
}

func num(v any) int {
	f, _ := v.(float64)
	return int(f)
}

// apply handles {"op": "damage"|"heal"|"temp", "amount": n}; false if not understood.
func (h *hpState) apply(data json.RawMessage) bool {
	var ev struct {
		Op     string  `json:"op"`
		Amount float64 `json:"amount"`
	}
	if json.Unmarshal(data, &ev) != nil || ev.Amount < 0 {
		return false
	}
	n := int(ev.Amount)
	h.mu.Lock()
	defer h.mu.Unlock()
	lost, temp := num(h.state["hpLost"]), num(h.state["tempHp"])
	switch ev.Op {
	case "damage": // Temporary Hit Points go first
		fromTemp := min(temp, n)
		temp -= fromTemp
		lost += n - fromTemp
	case "heal":
		lost = max(0, lost-n)
		h.state["deathSaves"] = map[string]any{"success": 0, "fail": 0}
	case "temp":
		temp = n
	default:
		return false
	}
	h.state["hpLost"], h.state["tempHp"] = float64(lost), float64(temp)
	return true
}

// send reports the state to the DM, like the app does after every change.
func (h *hpState) send(m *lan.Manager, who string) {
	h.mu.Lock()
	body, _ := json.Marshal(map[string]any{"state": h.state})
	lost, temp := num(h.state["hpLost"]), num(h.state["tempHp"])
	h.mu.Unlock()
	if err := m.Send("state", "", body); err != nil {
		log.Printf("[%s] state not sent: %v", who, err)
		return
	}
	log.Printf("[%s] state → DM: lost %d HP, %d temp", who, lost, temp)
}
