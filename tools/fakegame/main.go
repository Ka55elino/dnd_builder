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
//	start {"round":1}           → event "start" to all players
//	@Bruenor hp {"hp":-5}       → event "hp" to one player (by name or id prefix)
//	players                     → list players
//	quit                        → end the game (Ctrl+C works too)
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"sync"

	"dnd-builder-v3/lan"
)

func main() {
	name := flag.String("name", "Test Game", "game name")
	flag.Parse()
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

// findPlayer matches a name (case-insensitive) or an id prefix.
func findPlayer(dm *lan.Manager, q string) (lan.PlayerInfo, bool) {
	for _, p := range dm.Status().Players {
		if strings.EqualFold(p.Name, q) || strings.HasPrefix(p.ID, q) {
			return p, true
		}
	}
	return lan.PlayerInfo{}, false
}

func console(dm *lan.Manager, done chan struct{}) {
	defer close(done)
	fmt.Println(`type: <kind> [json]  ·  @<player> <kind> [json]  ·  players  ·  quit`)
	sc := bufio.NewScanner(os.Stdin)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		switch line {
		case "":
			continue
		case "quit", "exit":
			return
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
