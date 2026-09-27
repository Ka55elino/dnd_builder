package lan

import (
	"os"
	"regexp"
)

// ReadAppVersion reads APP_VERSION from a constants.go file (for the test tools,
// which can't import package main). "" if the file or the constant is missing.
func ReadAppVersion(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	m := regexp.MustCompile(`const APP_VERSION = "([^"]*)"`).FindSubmatch(b)
	if m == nil {
		return ""
	}
	return string(m[1])
}
