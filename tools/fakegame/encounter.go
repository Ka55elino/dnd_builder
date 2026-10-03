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
//
// The encounter's map (the player's read-only "Map" tab, see combat/PlayerMap.svelte):
// starting an encounter sends a map and puts everyone on it (players on the left, monsters
// on the right) — like the DM placing the tokens.
//
//	enc maps                 the maps in the seed campaigns (assets/data/campaigns/*.json)
//	enc map [name]           send another map: an owner from "enc maps" (or a part of it);
//	                         "enc map field" — a plain generated field
//	enc pos 3 2 -1           put the 3rd combatant into cell (2, -1)
//	enc place                put everyone back in the default places
//	enc off 3                take the 3rd combatant off the map

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
	encPos   = map[string]string{} // combatant id → "x,y"
	encMap   *encounterMap         // the map sent with the encounter (nil — none)
	dataRoot = "assets/data"
)

// encounterMap is the "encmap" event: { key, name, tiles: { tileId: [x, y, …] } }.
type encounterMap struct {
	Key   string           `json:"key"`
	Name  string           `json:"name"`
	Tiles map[string][]int `json:"tiles"`
}

// seedMaps reads the maps of the seed campaigns: owner ("encounter:enc_x") → tiles.
func seedMaps() []encounterMap {
	var out []encounterMap
	files, _ := filepath.Glob(filepath.Join(dataRoot, "campaigns", "*.json"))
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var c struct {
			Maps []struct {
				Owner string           `json:"owner"`
				Tiles map[string][]int `json:"tiles"`
			} `json:"maps"`
		}
		if json.Unmarshal(raw, &c) != nil {
			continue
		}
		for _, m := range c.Maps {
			if len(m.Tiles) > 0 {
				_, id, _ := strings.Cut(m.Owner, ":")
				name := strings.ReplaceAll(strings.TrimPrefix(strings.TrimPrefix(id, "enc_"), "loc_"), "_", " ")
				out = append(out, encounterMap{Key: m.Owner, Name: name, Tiles: m.Tiles})
			}
		}
	}
	// encounters' maps first: that is what an encounter normally opens
	sort.SliceStable(out, func(i, j int) bool {
		return strings.HasPrefix(out[i].Key, "encounter:") && !strings.HasPrefix(out[j].Key, "encounter:")
	})
	return out
}

// fieldMap: a generated map — grass, a road through the middle, a stream and a wood.
func fieldMap() *encounterMap {
	t := map[string][]int{}
	for y := -4; y <= 4; y++ {
		for x := -7; x <= 7; x++ {
			tile := "grass"
			switch {
			case y == 0:
				tile = "sand"
			case x == 3 && y != 0:
				tile = "water"
			case y <= -3 && x <= -3:
				tile = "forest"
			case y >= 3 && x >= 5:
				tile = "mountain"
			}
			t[tile] = append(t[tile], x, y)
		}
	}
	return &encounterMap{Key: "fake:field", Name: "Test field", Tiles: t}
}

// pickMap: by a part of its owner ("wolves"), "field", or the first seed map.
func pickMap(q string) *encounterMap {
	q = strings.ToLower(strings.TrimSpace(q))
	if q == "field" {
		return fieldMap()
	}
	for _, m := range seedMaps() {
		if q == "" || strings.Contains(strings.ToLower(m.Key), q) {
			m := m
			return &m
		}
	}
	if q == "" {
		return fieldMap()
	}
	return nil
}

// sendMap sends the encounter's map to everyone (or "no map"). Call with encMu held.
func sendMap(dm *lan.Manager) {
	data := any(map[string]any{})
	if encOn && encMap != nil {
		data = encMap
	}
	raw, _ := json.Marshal(data)
	if err := dm.Send("encmap", "", raw); err != nil && !strings.Contains(err.Error(), "not in a game") {
		fmt.Println("send:", err)
	}
}

// placeAll: players in a column on the left, monsters on the right (only those not placed
// yet, unless all). Call with encMu held.
func placeAll(all bool) {
	if all {
		encPos = map[string]string{}
	}
	taken := map[string]bool{}
	for _, p := range encPos {
		taken[p] = true
	}
	free := func(x, y int) string {
		for ; ; y++ {
			k := fmt.Sprintf("%d,%d", x, y)
			if !taken[k] {
				taken[k] = true
				return k
			}
		}
	}
	np, nm := 0, 0
	for _, c := range encLine {
		if _, ok := encPos[c.ID]; ok {
			continue
		}
		if c.Kind == "player" {
			encPos[c.ID] = free(-4, -1+np)
			np++
		} else {
			encPos[c.ID] = free(2+nm%2, -2+nm/2*2)
			nm++
		}
	}
}

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
		pos := map[string]string{}
		for _, c := range encLine {
			if p, ok := encPos[c.ID]; ok {
				pos[c.ID] = p
			}
		}
		data = map[string]any{"active": true, "name": "Test encounter", "turn": turn, "line": encLine, "positions": pos}
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
		placeAll(false) // newcomers get a place
	}
	sendEncounter(dm)
	sendMap(dm) // newcomers get the map
}

func printLine() {
	if !encOn {
		fmt.Println("no encounter (start one: enc goblin 3, ogre)")
		return
	}
	if encMap != nil {
		fmt.Printf("  map: %s\n", encMap.Key)
	}
	for i, c := range encLine {
		mark := " "
		if c.ID == encTurn {
			mark = "▶"
		}
		pos := encPos[c.ID]
		if pos == "" {
			pos = "—"
		}
		fmt.Printf("  %s %2d. %-24s %-8s at %s\n", mark, i+1, c.Name, c.Kind, pos)
	}
}

// nth: the combatant at place n (1-based) from a string.
func nth(s string) (combatant, bool) {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 1 || n > len(encLine) {
		return combatant{}, false
	}
	return encLine[n-1], true
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
		encOn, encLine, encTurn, encPos, encMap = false, nil, "", map[string]string{}, nil
		sendEncounter(dm)
		log.Print("encounter ended")
	case rest == "maps":
		for _, m := range seedMaps() {
			n := 0
			for _, xy := range m.Tiles {
				n += len(xy) / 2
			}
			fmt.Printf("  %-40s %d cells\n", m.Key, n)
		}
		fmt.Println("  field                                    a generated test field")
	case rest == "map" || strings.HasPrefix(rest, "map "):
		if !encOn {
			fmt.Println("no encounter (start one: enc goblin 3, ogre)")
			return true
		}
		m := pickMap(strings.TrimPrefix(rest, "map"))
		if m == nil {
			fmt.Println("no such map (see: enc maps)")
			return true
		}
		encMap = m
		sendMap(dm)
		log.Printf("map sent: %s", m.Key)
	case rest == "place":
		if !encOn {
			fmt.Println("no encounter")
			return true
		}
		placeAll(true)
		sendEncounter(dm)
		printLine()
	case strings.HasPrefix(rest, "pos "):
		f := strings.Fields(rest)
		c, ok := nth(f[1])
		x, err1 := 0, error(nil)
		y, err2 := 0, error(nil)
		if len(f) == 4 {
			x, err1 = strconv.Atoi(f[2])
			y, err2 = strconv.Atoi(f[3])
		}
		if !encOn || !ok || len(f) != 4 || err1 != nil || err2 != nil {
			fmt.Println("usage: enc pos <place> <x> <y> (see: enc)")
			return true
		}
		k := fmt.Sprintf("%d,%d", x, y)
		for id, p := range encPos {
			if p == k && id != c.ID {
				fmt.Println("this cell is taken")
				return true
			}
		}
		encPos[c.ID] = k
		sendEncounter(dm)
		printLine()
	case strings.HasPrefix(rest, "off "):
		c, ok := nth(strings.TrimPrefix(rest, "off "))
		if !encOn || !ok {
			fmt.Println("usage: enc off <place> (see: enc)")
			return true
		}
		delete(encPos, c.ID)
		sendEncounter(dm)
		printLine()
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
		// like the DM's screen: the encounter's map opens and the tokens go on it
		encMap = pickMap("")
		placeAll(true)
		sendEncounter(dm)
		sendMap(dm)
		log.Printf("encounter started: %d in order · map %s", len(line), encMap.Key)
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
