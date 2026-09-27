// version keeps the app version in one place: APP_VERSION in constants.go.
// Every other file that carries the version (build/config.yml and the platform
// files in build/) is updated from it — only the version strings are touched,
// so manual edits in those files survive (unlike `wails3 update build-assets`).
//
//	go run ./tools/version            # show the version and check every file matches
//	go run ./tools/version 0.3.1      # set a new version everywhere
//	go run ./tools/version -sync      # copy APP_VERSION from constants.go to the other files
//
// Or through the Taskfile: `wails3 task version`, `wails3 task version:set VERSION=0.3.1`.
// Run from the project root.
package main

import (
	"flag"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// spot is one place that holds the version. The pattern has three groups:
// what comes before the version, the version itself, what comes after.
type spot struct {
	file    string
	pattern *regexp.Regexp
	format  func(v semver) string // the value written there (default: "X.Y.Z")
	note    string
}

type semver struct{ major, minor, patch int }

func (v semver) String() string { return fmt.Sprintf("%d.%d.%d", v.major, v.minor, v.patch) }

var (
	plain    = func(v semver) string { return v.String() }
	fourPart = func(v semver) string { return v.String() + ".0" } // Windows packages want X.Y.Z.W
	devTag   = func(v semver) string { return v.String() + "-dev" }
	// Android versionCode must grow with every release: 0.3.0 → 300 (same formula as the CI)
	androidCode = func(v semver) string { return strconv.Itoa(v.major*10000 + v.minor*100 + v.patch) }
)

const ver = `(\d+\.\d+\.\d+)`

func re(s string) *regexp.Regexp { return regexp.MustCompile(s) }

// source of truth
var source = spot{file: "constants.go", pattern: re(`(const APP_VERSION = ")` + ver + `(")`)}

var spots = []spot{
	{file: "build/config.yml", pattern: re(`(?m)(^  version: ")` + ver + `(")`), note: "info.version"},
	{file: "build/config.yml", pattern: re(`(?m)(^#   version: ")` + ver + `(")`), note: "ios example (comment)"},

	{file: "build/darwin/Info.plist", pattern: re(`(<key>CFBundleShortVersionString</key>\s*<string>)` + ver + `(</string>)`)},
	{file: "build/darwin/Info.plist", pattern: re(`(<key>CFBundleVersion</key>\s*<string>)` + ver + `(</string>)`)},
	{file: "build/darwin/Info.dev.plist", pattern: re(`(<key>CFBundleShortVersionString</key>\s*<string>)` + ver + `(</string>)`)},
	{file: "build/darwin/Info.dev.plist", pattern: re(`(<key>CFBundleVersion</key>\s*<string>)` + ver + `(</string>)`)},

	{file: "build/ios/Info.plist", pattern: re(`(<key>CFBundleShortVersionString</key>\s*<string>)` + ver + `(</string>)`)},
	{file: "build/ios/Info.plist", pattern: re(`(<key>CFBundleVersion</key>\s*<string>)` + ver + `(</string>)`)},
	{file: "build/ios/Info.dev.plist", pattern: re(`(<key>CFBundleShortVersionString</key>\s*<string>)` + ver + `(-dev</string>)`), format: plain},
	{file: "build/ios/Info.dev.plist", pattern: re(`(<key>CFBundleVersion</key>\s*<string>)` + ver + `(</string>)`)},

	{file: "build/linux/nfpm/nfpm.yaml", pattern: re(`(?m)(^version: ")` + ver + `(")`)},

	{file: "build/windows/info.json", pattern: re(`("file_version": ")` + ver + `(")`)},
	{file: "build/windows/info.json", pattern: re(`("ProductVersion": ")` + ver + `(")`)},
	{file: "build/windows/wails.exe.manifest", pattern: re(`(<assemblyIdentity [^>]*version=")` + ver + `(")`)},
	{file: "build/windows/nsis/wails_tools.nsh", pattern: re(`(!define INFO_PRODUCTVERSION ")` + ver + `(")`)},
	{file: "build/windows/nsis/project.nsi", pattern: re(`(# Default ")` + ver + `(")`), note: "comment"},
	{file: "build/windows/msix/app_manifest.xml", pattern: re(`(<Identity[\s\S]*?Version=")` + ver + `(\.0")`), format: plain},
	{file: "build/windows/msix/template.xml", pattern: re(`(Version=")` + ver + `(\.0")`), format: plain},

	{file: "build/android/app/build.gradle", pattern: re(`(versionName ")` + `([^"]*)` + `(")`), note: "versionName"},
	{file: "build/android/app/build.gradle", pattern: re(`(versionCode )` + `(\d+)` + `()`), format: androidCode, note: "versionCode"},
}

func parse(s string) (semver, error) {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	m := regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)$`).FindStringSubmatch(s)
	if m == nil {
		return semver{}, fmt.Errorf("%q is not a version like 0.3.1", s)
	}
	a, _ := strconv.Atoi(m[1])
	b, _ := strconv.Atoi(m[2])
	c, _ := strconv.Atoi(m[3])
	if b > 99 || c > 99 {
		return semver{}, fmt.Errorf("minor and patch must be ≤ 99 (Android versionCode)")
	}
	return semver{a, b, c}, nil
}

func (s spot) want(v semver) string {
	if s.format != nil {
		return s.format(v)
	}
	return plain(v)
}

func (s spot) label() string {
	if s.note != "" {
		return s.file + " (" + s.note + ")"
	}
	return s.file
}

// read returns the current value at a spot.
func read(s spot) (string, error) {
	b, err := os.ReadFile(s.file)
	if err != nil {
		return "", err
	}
	m := s.pattern.FindSubmatch(b)
	if m == nil {
		return "", fmt.Errorf("version not found (the file format changed?)")
	}
	return string(m[2]), nil
}

// write sets the value at a spot; returns the old one.
func write(s spot, v semver) (string, error) {
	b, err := os.ReadFile(s.file)
	if err != nil {
		return "", err
	}
	m := s.pattern.FindSubmatchIndex(b)
	if m == nil {
		return "", fmt.Errorf("version not found (the file format changed?)")
	}
	old := string(b[m[4]:m[5]])
	out := append([]byte{}, b[:m[4]]...)
	out = append(out, s.want(v)...)
	out = append(out, b[m[5]:]...)
	if old == s.want(v) {
		return old, nil
	}
	return old, os.WriteFile(s.file, out, 0o644)
}

func main() {
	sync := flag.Bool("sync", false, "copy APP_VERSION from constants.go to all other files")
	flag.Parse()

	if _, err := os.Stat("constants.go"); err != nil {
		fail("run from the project root (constants.go not found)")
	}

	cur, err := read(source)
	if err != nil {
		fail("constants.go: %v", err)
	}
	v, err := parse(cur)
	if err != nil {
		fail("constants.go: %v", err)
	}

	switch {
	case flag.NArg() == 1: // set
		nv, err := parse(flag.Arg(0))
		if err != nil {
			fail("%v", err)
		}
		if _, err := write(source, nv); err != nil {
			fail("constants.go: %v", err)
		}
		fmt.Printf("%s → %s\n", v, nv)
		apply(nv)
		warnDB(v, nv)
	case *sync:
		fmt.Printf("syncing %s from constants.go\n", v)
		apply(v)
	case flag.NArg() == 0: // check
		fmt.Printf("APP_VERSION %s\n", v)
		bad := 0
		for _, s := range spots {
			got, err := read(s)
			switch {
			case err != nil:
				fmt.Printf("  ✗ %-50s %v\n", s.label(), err)
				bad++
			case got != s.want(v):
				fmt.Printf("  ✗ %-50s %s (want %s)\n", s.label(), got, s.want(v))
				bad++
			default:
				fmt.Printf("  ✓ %-50s %s\n", s.label(), got)
			}
		}
		if bad > 0 {
			fail("%d place(s) out of sync — run: go run ./tools/version -sync", bad)
		}
	default:
		fail("usage: go run ./tools/version [NEW_VERSION | -sync]")
	}
}

func apply(v semver) {
	failed := 0
	for _, s := range spots {
		old, err := write(s, v)
		if err != nil {
			fmt.Printf("  ✗ %-50s %v\n", s.label(), err)
			failed++
			continue
		}
		mark := "="
		if old != s.want(v) {
			mark = "✓"
		}
		fmt.Printf("  %s %-50s %s\n", mark, s.label(), s.want(v))
	}
	if failed > 0 {
		fail("%d place(s) could not be updated", failed)
	}
}

// APP_VERSION is part of the database file name (see dbFileName in db.go).
func warnDB(from, to semver) {
	if from == to {
		return
	}
	fmt.Printf("\nNote: the database file name includes the version — %s opens dnd-v%s.db,\n"+
		"characters saved in dnd-v%s.db don't carry over by themselves.\n", to, to, from)
}

func fail(format string, a ...any) {
	fmt.Fprintf(os.Stderr, "version: "+format+"\n", a...)
	os.Exit(1)
}
