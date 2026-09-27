package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"dnd-builder-v3/lan"
)

// Encounters, like the DM screen's "Start encounter": the initiative line is
// the players (in lobby order) and then the monsters, and every player gets the
// "encounter" event (names, icons, order — see frontend/src/combat.svelte.js).
//
//	enc goblin 3, ogre       start: 3 Goblin Warriors and an Ogre (id or part of the name)
//	enc                      show the current line
//	enc move 3 1             move the 3rd combatant to place 1
//	enc turn 2 · enc next    mark whose turn it is: the 2nd · the next one (players see a check)
//	enc end                  end the encounter
//	monsters                 the monsters from assets/data/monsters

type seedMonster struct {
	ID, Name, Image, Type string
	CR                    float64
}

type combatant struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"` // player | monster
	Name     string `json:"name"`
	Image    string `json:"image"`
	Type     string `json:"type"`
	PlayerID string `json:"playerId"`
}

var (
	monsters []seedMonster
	encMu    sync.Mutex
	encOn    bool
	encLine  []combatant
	encTurn  string // id of the combatant whose turn it is
	encSeq   int
)

func loadMonsters(root string) []seedMonster {
	var out []seedMonster
	_ = filepath.WalkDir(filepath.Join(root, "monsters"), func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".json") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		var m struct {
			ID    string  `json:"id"`
			Name  string  `json:"name"`
			Image string  `json:"image"`
			Type  string  `json:"type"`
			CR    float64 `json:"cr"`
		}
		if json.Unmarshal(raw, &m) == nil && m.ID != "" {
			out = append(out, seedMonster{m.ID, m.Name, m.Image, m.Type, m.CR})
		}
		return nil
	})
	sort.Slice(out, func(i, j int) bool {
		return out[i].CR < out[j].CR || (out[i].CR == out[j].CR && out[i].Name < out[j].Name)
	})
	return out
}

func findMonster(q string) (seedMonster, bool) {
	q = strings.ToLower(strings.TrimSpace(q))
	for _, m := range monsters {
		if strings.ToLower(m.ID) == q {
			return m, true
		}
	}
	for _, m := range monsters {
		if strings.Contains(strings.ToLower(m.Name), q) {
			return m, true
		}
	}
	return seedMonster{}, false
}

func playerCombatant(p lan.PlayerInfo) combatant {
	return combatant{ID: "p:" + p.ID, Kind: "player", Name: p.Name, Image: p.Portrait, PlayerID: p.ID}
}

// sendEncounter sends the line (or "no encounter") to everyone. Call with encMu held.
func sendEncounter(dm *lan.Manager) {
	data := map[string]any{"active": false}
	if encOn {
		turn := any(nil)
		if encTurn != "" {
			turn = encTurn
		}
		data = map[string]any{"active": true, "name": "", "turn": turn, "line": encLine}
	}
	raw, _ := json.Marshal(data)
	if err := dm.Send("encounter", "", raw); err != nil && !strings.Contains(err.Error(), "not in a game") {
		fmt.Println("send:", err) // "not in a game" — the game is shutting down
	}
}

// encounterPlayersChanged keeps the players in the line in step with the lobby
// (newcomers at the end) and catches newcomers up. Called on every lobby change.
func encounterPlayersChanged(dm *lan.Manager, players []lan.PlayerInfo) {
	encMu.Lock()
	defer encMu.Unlock()
	if encOn {
		ids := map[string]bool{}
		for _, p := range players {
			ids[p.ID] = true
		}
		kept := encLine[:0]
		for _, c := range encLine {
			if c.Kind != "player" || ids[c.PlayerID] {
				kept = append(kept, c)
			}
		}
		encLine = kept
		still := false
		for _, c := range encLine {
			still = still || c.ID == encTurn
		}
		if !still {
			encTurn = ""
		}
		for _, p := range players {
			found := false
			for _, c := range encLine {
				found = found || c.PlayerID == p.ID
			}
			if !found {
				encLine = append(encLine, playerCombatant(p))
			}
		}
	}
	sendEncounter(dm)
}

func printLine() {
	if !encOn {
		fmt.Println("no encounter (start one: enc goblin 3, ogre)")
		return
	}
	for i, c := range encLine {
		mark := " "
		if c.ID == encTurn {
			mark = "▶"
		}
		fmt.Printf("  %s %2d. %-24s %s\n", mark, i+1, c.Name, c.Kind)
	}
}

// encounterCommand handles "enc …"; returns false if the line isn't an enc command.
func encounterCommand(dm *lan.Manager, line string) bool {
	cmd, rest, _ := strings.Cut(line, " ")
	switch cmd {
	case "monsters":
		if len(monsters) == 0 {
			fmt.Println("no monsters found (run from the project root or pass -data)")
		}
		for _, m := range monsters {
			fmt.Printf("  CR %-5s %-22s %s (%s)\n", crText(m.CR), m.ID, m.Name, m.Type)
		}
		return true
	case "enc", "encounter":
	default:
		return false
	}
	rest = strings.TrimSpace(rest)
	encMu.Lock()
	defer encMu.Unlock()

	switch {
	case rest == "":
		printLine()
	case rest == "end":
		encOn, encLine, encTurn = false, nil, ""
		sendEncounter(dm)
		log.Print("encounter ended")
	case rest == "next" || strings.HasPrefix(rest, "turn"):
		if !encOn || len(encLine) == 0 {
			fmt.Println("no encounter")
			return true
		}
		i := 0
		if rest == "next" {
			for j, c := range encLine {
				if c.ID == encTurn {
					i = (j + 1) % len(encLine)
				}
			}
		} else {
			n, err := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(rest, "turn")))
			if err != nil || n < 1 || n > len(encLine) {
				fmt.Println("usage: enc turn <place> (see: enc)")
				return true
			}
			i = n - 1
		}
		encTurn = encLine[i].ID
		sendEncounter(dm)
		printLine()
	case strings.HasPrefix(rest, "move "):
		f := strings.Fields(rest)
		from, err1 := strconv.Atoi(f[1])
		to, err2 := 0, error(nil)
		if len(f) > 2 {
			to, err2 = strconv.Atoi(f[2])
		}
		if !encOn || len(f) != 3 || err1 != nil || err2 != nil || from < 1 || to < 1 || from > len(encLine) || to > len(encLine) {
			fmt.Println("usage: enc move <from> <to> (places, see: enc)")
			return true
		}
		c := encLine[from-1]
		encLine = append(encLine[:from-1], encLine[from:]...)
		encLine = append(encLine[:to-1], append([]combatant{c}, encLine[to-1:]...)...)
		sendEncounter(dm)
		printLine()
	default: // start: "goblin 3, ogre"
		line := []combatant{}
		for _, p := range dm.Status().Players {
			line = append(line, playerCombatant(p))
		}
		for _, part := range strings.Split(rest, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			what, n := part, 1
			if i := strings.LastIndex(part, " "); i > 0 {
				if v, err := strconv.Atoi(part[i+1:]); err == nil && v > 0 {
					what, n = part[:i], v
				}
			}
			m, ok := findMonster(what)
			if !ok {
				fmt.Println("no such monster:", what, "(see: monsters)")
				return true
			}
			for i := 1; i <= n; i++ {
				encSeq++
				name := m.Name
				if n > 1 {
					name = fmt.Sprintf("%s %d", m.Name, i)
				}
				line = append(line, combatant{ID: fmt.Sprintf("m%d", encSeq), Kind: "monster", Name: name, Image: m.Image, Type: m.Type})
			}
		}
		encOn, encLine, encTurn = true, line, ""
		sendEncounter(dm)
		log.Printf("encounter started: %d in order", len(line))
		printLine()
	}
	return true
}

func crText(cr float64) string {
	switch cr {
	case 0.125:
		return "1/8"
	case 0.25:
		return "1/4"
	case 0.5:
		return "1/2"
	}
	return strconv.FormatFloat(cr, 'f', -1, 64)
}
