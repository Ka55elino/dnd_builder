// fakegame hosts a game like the DM's "Start Game" does (WebSocket server +
// mDNS announcement), prints who joins/leaves and what players send, and lets
// you send events from the console. For local testing of "Join Game".
//
//	go run ./tools/fakegame                     # "Test Game" on port 47800 (or the next free one)
//	go run ./tools/fakegame -name "Lost Mine"
//
// The app and fakegame can both run on one Mac: if the app is not hosting,
// "Join Game" finds fakegame via mDNS, or connect by address 127.0.0.1:47800.
//
// Console:
//
//	start {"round":1}                       → event "start" to all players
//	@Bruenor hp {"op":"damage","amount":5}  → event to one player (by name or id prefix)
//	w Bruenor You hear a click behind you.   → whisper: a popup only that player sees
//	dmg Bruenor 5 · heal Bruenor 3 · temp Bruenor 4
//	                                         → Hit Points, like the buttons on the DM's card
//	items                                   → named items the DM can give
//	give Bruenor dawnbringer [2]             → give an item (id or part of its name), like the card's button
//	players                                 → list players
//	quit                                    → end the game (Ctrl+C works too)
//
// <player> is the full name, its first word ("Grom" for "Grom Stonejaw") or
// the start of the player id (see "players"); case doesn't matter.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"

	"dnd-builder-v3/lan"
)

func main() {
	name := flag.String("name", "Test Game", "game name")
	data := flag.String("data", "assets/data", "seed data folder (for the named items list)")
	flag.Parse()
	items = loadNamedItems(*data)
	log.SetFlags(log.Ltime)

	var dm *lan.Manager
	var (
		mu   sync.Mutex // events arrive from several goroutines
		last []lan.PlayerInfo
	)
	dm = lan.NewManager(func(event string, data any) {
		switch v := data.(type) {
		case lan.Status:
			mu.Lock()
			last = diffPlayers(last, v.Players)
			mu.Unlock()
		case lan.Event:
			log.Printf("← %s: %q %s", playerName(dm, v.From), v.Kind, string(v.Data))
		}
	})

	st, err := dm.Host(*name)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("hosting “%s” at %s:%d (also 127.0.0.1:%d)", st.Game.Name, st.LocalIP, st.Game.Port, st.Game.Port)

	done := make(chan struct{})
	go console(dm, done)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	select {
	case <-sig:
	case <-done:
	}
	dm.Close()
	log.Print("game ended")
}

// diffPlayers logs joins and leaves.
func diffPlayers(old, cur []lan.PlayerInfo) []lan.PlayerInfo {
	was := map[string]lan.PlayerInfo{}
	for _, p := range old {
		was[p.ID] = p
	}
	now := map[string]bool{}
	for _, p := range cur {
		now[p.ID] = true
		if _, ok := was[p.ID]; !ok {
			log.Printf("+ %s joined (%s, level %d) · id %s", p.Name, p.ClassName, p.Level, p.ID)
		}
	}
	for _, p := range old {
		if !now[p.ID] {
			log.Printf("- %s left", p.Name)
		}
	}
	return append([]lan.PlayerInfo(nil), cur...)
}

func playerName(dm *lan.Manager, id string) string {
	for _, p := range dm.Status().Players {
		if p.ID == id {
			return p.Name
		}
	}
	return id
}

// items are the named items the DM can give (loaded from the seed data).
var items []namedItem

func shortcut(cmd string) bool {
	switch cmd {
	case "w", "whisper", "dmg", "heal", "temp", "give":
		return true
	}
	return false
}

// findPlayer matches the full name, the first word of the name (case-insensitive)
// or an id prefix.
func findPlayer(dm *lan.Manager, q string) (lan.PlayerInfo, bool) {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "" {
		return lan.PlayerInfo{}, false
	}
	for _, p := range dm.Status().Players {
		name := strings.ToLower(p.Name)
		first, _, _ := strings.Cut(name, " ")
		if name == q || first == q || strings.HasPrefix(p.ID, q) {
			return p, true
		}
	}
	return lan.PlayerInfo{}, false
}

func console(dm *lan.Manager, done chan struct{}) {
	defer close(done)
	fmt.Println(`type: w <player> <text>  ·  dmg|heal|temp <player> <n>  ·  give <player> <item> [n]  ·  items  ·  <kind> [json]  ·  @<player> <kind> [json]  ·  players  ·  quit`)
	sc := bufio.NewScanner(os.Stdin)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		switch line {
		case "":
			continue
		case "quit", "exit":
			return
		case "items":
			if len(items) == 0 {
				fmt.Println("no named items found (run from the project root or pass -data)")
			}
			for _, it := range items {
				fmt.Printf("  %-7s %-22s %s\n", it.Kind, it.ID, it.Name)
			}
			continue
		case "players":
			list := dm.Status().Players
			if len(list) == 0 {
				fmt.Println("no players")
			}
			for _, p := range list {
				fmt.Printf("  %s  %s (%s, level %d)\n", p.ID, p.Name, p.ClassName, p.Level)
			}
			continue
		}

		// shortcuts for the DM card's actions
		if cmd, rest, _ := strings.Cut(line, " "); shortcut(cmd) {
			who, arg, _ := strings.Cut(strings.TrimSpace(rest), " ")
			p, ok := findPlayer(dm, who)
			if !ok {
				fmt.Println("no such player:", who)
				continue
			}
			var data any
			switch cmd {
			case "w", "whisper":
				text := strings.TrimSpace(arg)
				if text == "" {
					fmt.Println("usage: w <player> <text>")
					continue
				}
				cmd, data = "whisper", map[string]any{"text": text}
			case "give":
				what, qtyStr := strings.TrimSpace(arg), ""
				if i := strings.LastIndex(what, " "); i > 0 {
					if _, err := strconv.Atoi(what[i+1:]); err == nil {
						what, qtyStr = what[:i], what[i+1:]
					}
				}
				it, ok := findItem(items, what)
				if !ok {
					fmt.Println("no such named item:", what, "(see: items)")
					continue
				}
				qty := 1
				if qtyStr != "" {
					qty, _ = strconv.Atoi(qtyStr)
				}
				data = map[string]any{"kind": it.Kind, "id": it.ID, "name": it.Name, "qty": max(qty, 1)}
			default:
				n, err := strconv.Atoi(strings.TrimSpace(arg))
				if err != nil || n < 0 {
					fmt.Printf("usage: %s <player> <number>\n", cmd)
					continue
				}
				op := map[string]string{"dmg": "damage", "heal": "heal", "temp": "temp"}[cmd]
				cmd, data = "hp", map[string]any{"op": op, "amount": n}
			}
			raw, _ := json.Marshal(data)
			if err := dm.Send(cmd, p.ID, raw); err != nil {
				fmt.Println("send:", err)
			} else {
				log.Printf("→ %s: %q %s", p.Name, cmd, raw)
			}
			continue
		}

		to := ""
		if strings.HasPrefix(line, "@") {
			who, rest, _ := strings.Cut(line[1:], " ")
			p, ok := findPlayer(dm, who)
			if !ok {
				fmt.Println("no such player:", who)
				continue
			}
			to, line = p.ID, strings.TrimSpace(rest)
		}
		kind, data, _ := strings.Cut(line, " ")
		data = strings.TrimSpace(data)
		if kind == "" {
			fmt.Println("event kind is empty")
			continue
		}
		if data != "" && !json.Valid([]byte(data)) {
			fmt.Println("data is not valid JSON")
			continue
		}
		if err := dm.Send(kind, to, json.RawMessage(data)); err != nil {
			fmt.Println("send:", err)
		}
	}
}
