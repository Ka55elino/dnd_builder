// fakeplayer joins a running game as one or more fake players, prints what
// the DM sends and lets you send events from the console. For local testing
// of "Start Game" without a second device.
//
// Each fake player joins with a real character — picked at random from the
// app's database (the newest dnd-*.db in the app data folder), or from the
// seed files in assets/data/characters if there is no database — so the DM
// sees a full character card.
//
//	go run ./tools/fakeplayer                        # 1 random character → 127.0.0.1:47800
//	go run ./tools/fakeplayer -n 3                   # 3 different characters
//	go run ./tools/fakeplayer -character rogue       # a specific one (id or part of the name)
//	go run ./tools/fakeplayer -name Bruenor          # rename the character
//	go run ./tools/fakeplayer -list                  # show available characters
//	go run ./tools/fakeplayer -addr 192.168.1.229:47800
//	go run ./tools/fakeplayer -discover              # only list games found via mDNS
//
// Console, after joining:
//
//	roll {"d":20,"value":17}   → sends event "roll" with that JSON from every player
//	ping                       → event without data
//	quit                       → leave (Ctrl+C works too)
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand/v2"
	"os"
	"os/signal"
	"strings"
	"time"

	"dnd-builder-v3/lan"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:47800", "DM address, ip[:port]")
	n := flag.Int("n", 1, "number of players to join")
	pick := flag.String("character", "", "character id or part of its name (default: random)")
	name := flag.String("name", "", "rename the character (with -n > 1 a number is appended)")
	dbPath := flag.String("db", "", "app database file (default: the newest dnd-*.db in the app data folder)")
	seeds := flag.String("seeds", "assets/data/characters", "seed characters, used when there is no database")
	list := flag.Bool("list", false, "list available characters and exit")
	discover := flag.Bool("discover", false, "only list games found on the network (mDNS) and exit")
	flag.Parse()
	log.SetFlags(log.Ltime)

	if *discover {
		runDiscover()
		return
	}

	chars, source, err := loadCharacters(*dbPath, *seeds)
	if err != nil {
		log.Fatal(err)
	}
	if *list {
		fmt.Printf("%d characters from %s:\n", len(chars), source)
		for _, c := range chars {
			fmt.Printf("  %-24s %s (%s, level %d)\n", c.info.CharacterID, c.info.Name, c.info.ClassName, c.info.Level)
		}
		return
	}
	chosen, err := choose(chars, *pick, *n)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("characters from %s", source)

	var players []*lan.Manager
	for i, c := range chosen {
		if *name != "" {
			nm := *name
			if *n > 1 {
				nm = fmt.Sprintf("%s %d", *name, i+1)
			}
			c = c.withName(nm)
		}
		m := lan.NewManager(printer(c.info.Name))
		st, err := m.Join(*addr, c.info, c.snap)
		if err != nil {
			log.Fatalf("%s: %v", c.info.Name, err)
		}
		log.Printf("%s (%s, level %d) joined “%s” as %s", c.info.Name, c.info.ClassName, c.info.Level, st.Game.Name, st.PlayerID)
		players = append(players, m)
	}

	done := make(chan struct{})
	go console(players, done)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	select {
	case <-sig:
	case <-done:
	}
	for _, m := range players {
		m.Close()
	}
	log.Print("left")
}

// choose picks n characters: the one matching `pick` (id or part of the
// name), or random ones — all different while there are enough.
func choose(chars []fakeChar, pick string, n int) ([]fakeChar, error) {
	if n < 1 {
		n = 1
	}
	pool := chars
	if pick != "" {
		pool = nil
		q := strings.ToLower(pick)
		for _, c := range chars {
			if strings.ToLower(c.info.CharacterID) == q || strings.Contains(strings.ToLower(c.info.Name), q) ||
				strings.Contains(strings.ToLower(c.info.CharacterID), q) {
				pool = append(pool, c)
			}
		}
		if len(pool) == 0 {
			return nil, fmt.Errorf("no character matches %q (see -list)", pick)
		}
	}
	shuffled := append([]fakeChar(nil), pool...)
	rand.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })

	out := make([]fakeChar, 0, n)
	for i := 0; i < n; i++ {
		c := shuffled[i%len(shuffled)]
		if i >= len(shuffled) { // more players than characters: same sheet, numbered name
			c = c.withName(fmt.Sprintf("%s %d", c.info.Name, i/len(shuffled)+1))
		}
		out = append(out, c)
	}
	return out, nil
}

// printer logs everything the network layer reports for one player.
func printer(who string) func(string, any) {
	return func(name string, data any) {
		switch v := data.(type) {
		case lan.Status:
			if v.Role == lan.RoleNone && v.Error != "" {
				log.Printf("[%s] disconnected: %s", who, v.Error)
				return
			}
			names := make([]string, 0, len(v.Players))
			for _, p := range v.Players {
				s := p.Name
				if !p.Online {
					s += " (offline)"
				}
				names = append(names, s)
			}
			log.Printf("[%s] %s · lobby: %s", who, v.State, strings.Join(names, ", "))
		case lan.Event:
			to := "all"
			if v.To != "" {
				to = "me"
			}
			log.Printf("[%s] event %q (to %s): %s", who, v.Kind, to, string(v.Data))
		default:
			b, _ := json.Marshal(data)
			log.Printf("[%s] %s %s", who, name, b)
		}
	}
}

func console(players []*lan.Manager, done chan struct{}) {
	defer close(done)
	sc := bufio.NewScanner(os.Stdin)
	fmt.Println(`type: <kind> [json]   e.g.  roll {"d":20,"value":17}   ·   quit`)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		if line == "quit" || line == "exit" {
			return
		}
		kind, data, _ := strings.Cut(line, " ")
		data = strings.TrimSpace(data)
		if data != "" && !json.Valid([]byte(data)) {
			fmt.Println("data is not valid JSON")
			continue
		}
		for _, m := range players {
			if err := m.Send(kind, "", json.RawMessage(data)); err != nil {
				fmt.Println("send:", err)
			}
		}
	}
}

func runDiscover() {
	found := make(chan lan.GamesList, 8)
	m := lan.NewManager(func(name string, data any) {
		if g, ok := data.(lan.GamesList); ok {
			found <- g
		}
	})
	defer m.Close()
	m.StartDiscovery()
	log.Print("searching for 6 seconds…")
	deadline := time.After(6 * time.Second)
	var last lan.GamesList
	for {
		select {
		case g := <-found:
			last = g
		case <-deadline:
			if len(last.Games) == 0 {
				log.Print("no games found")
			}
			for _, g := range last.Games {
				log.Printf("“%s” at %s:%d · %d players", g.Name, g.Host, g.Port, g.Players)
			}
			return
		}
	}
}
