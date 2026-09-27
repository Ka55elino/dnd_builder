package lan

import (
	"context"
	"log"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/grandcat/zeroconf"
)

const (
	browseRound = 3 * time.Second  // one mDNS query round
	browsePause = 1 * time.Second  // pause between rounds
	gameExpiry  = 10 * time.Second // a game not seen this long is gone
)

// discovery browses mDNS in rounds until stopped and reports the list of
// games whenever it changes. Rounds (instead of one long browse) make games
// that were shut down without a goodbye packet disappear.
type discovery struct {
	m        *Manager
	cancel   context.CancelFunc
	seen     map[string]seenGame
	last     string // signature of the last reported list
	reported bool
}

type seenGame struct {
	info GameInfo
	at   time.Time
}

func startDiscovery(m *Manager) *discovery {
	ctx, cancel := context.WithCancel(context.Background())
	d := &discovery{m: m, cancel: cancel, seen: map[string]seenGame{}}
	go d.run(ctx)
	return d
}

func (d *discovery) stop() { d.cancel() }

func (d *discovery) run(ctx context.Context) {
	d.report() // empty list right away, so the UI isn't stale
	for ctx.Err() == nil {
		d.round(ctx)
		d.expire()
		d.report()
		select {
		case <-ctx.Done():
		case <-time.After(browsePause):
		}
	}
}

func (d *discovery) round(ctx context.Context) {
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		log.Printf("[lan] mDNS resolver: %v", err)
		time.Sleep(browseRound)
		return
	}
	rctx, cancel := context.WithTimeout(ctx, browseRound)
	defer cancel()

	entries := make(chan *zeroconf.ServiceEntry, 16)
	if err := resolver.Browse(rctx, ServiceType, ServiceDomain, entries); err != nil {
		log.Printf("[lan] mDNS browse: %v", err)
		<-rctx.Done()
		return
	}
	for {
		select {
		case <-rctx.Done():
			return
		case e, ok := <-entries:
			if !ok {
				return
			}
			if g, ok := parseEntry(e); ok {
				d.seen[g.ID] = seenGame{info: g, at: time.Now()}
				d.report() // show new games immediately, not at the end of the round
			}
		}
	}
}

func parseEntry(e *zeroconf.ServiceEntry) (GameInfo, bool) {
	txt := map[string]string{}
	for _, t := range e.Text {
		if k, v, ok := strings.Cut(t, "="); ok {
			txt[k] = v
		}
	}
	ip := pickIPv4(e.AddrIPv4)
	if t := net.ParseIP(txt["ip"]); t != nil && t.To4() != nil {
		ip = t.String()
	}
	if ip == "" || e.Port == 0 {
		return GameInfo{}, false
	}
	g := GameInfo{
		ID:   txt["id"],
		Name: txt["name"],
		Host: ip,
		Port: e.Port,
	}
	if g.ID == "" {
		g.ID = e.Instance
	}
	if g.Name == "" {
		g.Name = e.Instance
	}
	g.Players, _ = strconv.Atoi(txt["players"])
	g.Protocol, _ = strconv.Atoi(txt["v"])
	return g, true
}

// pickIPv4 prefers a private LAN address (a host can have several).
func pickIPv4(ips []net.IP) string {
	for _, ip := range ips {
		if ip.IsPrivate() {
			return ip.String()
		}
	}
	for _, ip := range ips {
		if !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
			return ip.String()
		}
	}
	return ""
}

func (d *discovery) expire() {
	for id, g := range d.seen {
		if time.Since(g.at) > gameExpiry {
			delete(d.seen, id)
		}
	}
}

func (d *discovery) report() {
	list := make([]GameInfo, 0, len(d.seen))
	for _, g := range d.seen {
		list = append(list, g.info)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })

	var sig strings.Builder
	for _, g := range list {
		sig.WriteString(g.ID + "|" + g.Name + "|" + g.Host + ":" + strconv.Itoa(g.Port) + "|" + strconv.Itoa(g.Players) + ";")
	}
	if d.reported && sig.String() == d.last {
		return
	}
	d.last, d.reported = sig.String(), true
	d.m.emit(EventGames, GamesList{Games: list})
}

// GamesList is the payload of the "net:games" event.
type GamesList struct {
	Games []GameInfo `json:"games"`
}
