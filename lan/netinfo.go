package lan

import (
	"crypto/rand"
	"encoding/hex"
	"net"
	"strconv"
	"strings"
)

// LocalIP returns this machine's IPv4 address in the local network,
// or "" if there is none.
//
// First it asks the OS which address it would use for outgoing traffic
// (a UDP "dial" sends nothing); if there is no route, it falls back to the
// first private address on an up, non-loopback interface.
func LocalIP() string {
	if c, err := net.Dial("udp4", "192.0.2.1:9"); err == nil { // TEST-NET-1, never contacted
		ip := c.LocalAddr().(*net.UDPAddr).IP
		c.Close()
		if ip.To4() != nil && !ip.IsLoopback() {
			return ip.String()
		}
	}
	var fallback string
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok || ipn.IP.To4() == nil {
				continue
			}
			if ipn.IP.IsPrivate() {
				return ipn.IP.String()
			}
			if fallback == "" && !ipn.IP.IsLinkLocalUnicast() {
				fallback = ipn.IP.String()
			}
		}
	}
	return fallback
}

// normalizeAddress turns "192.168.1.5", "192.168.1.5:47801" or
// "ws://192.168.1.5:47801/ws" into "host:port".
func normalizeAddress(addr string) (string, error) {
	addr = strings.TrimSpace(addr)
	addr = strings.TrimPrefix(addr, "ws://")
	addr = strings.TrimSuffix(addr, wsPath)
	addr = strings.TrimSuffix(addr, "/")
	if addr == "" {
		return "", errString("enter the DM's address")
	}
	if _, _, err := net.SplitHostPort(addr); err != nil {
		// no port — use the default one
		addr = net.JoinHostPort(addr, strconv.Itoa(DefaultPort))
	}
	return addr, nil
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type errString string

func (e errString) Error() string { return string(e) }
