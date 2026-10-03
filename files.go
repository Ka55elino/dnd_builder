package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Saving and opening files through the system dialogs (character export/import).
// The webview can't download or pick files on its own on every platform, so the
// Go side shows the native "Save as…" / "Open…" dialog and does the file I/O.

// maxOpenFile is the largest file OpenTextFile reads (a character with a few
// uploaded pictures is well under a megabyte).
const maxOpenFile = 32 << 20

// SaveTextFile asks where to save (the name is suggested) and writes the content
// there. Returns the path, or "" if the user cancelled.
func (a *App) SaveTextFile(suggestedName, content string) (string, error) {
	return saveFileAs(suggestedName, "JSON", ".json", []byte(content))
}

// OpenTextFile asks for a JSON file and returns its content, or "" if the user cancelled.
func (a *App) OpenTextFile(title string) (string, error) {
	app := application.Get()
	if app == nil {
		return "", errors.New("no application")
	}
	path, err := app.Dialog.OpenFile().
		SetTitle(title).
		AddFilter("JSON", "*.json").
		CanChooseFiles(true).
		PromptForSingleSelection()
	if err != nil || path == "" {
		return "", err
	}
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("could not open the file: %w", err)
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxOpenFile+1))
	if err != nil {
		return "", fmt.Errorf("could not read the file: %w", err)
	}
	if len(b) > maxOpenFile {
		return "", fmt.Errorf("the file is too big (over %d MB)", maxOpenFile>>20)
	}
	return string(b), nil
}

// safeFileName keeps a suggested file name usable on every OS (a .json file).
func safeFileName(s string) string { return safeName(s, ".json") }

// safeName: the suggested name without characters some OS forbid, with the extension.
func safeName(s, ext string) string {
	s = strings.TrimSpace(s)
	s = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`/\:*?"<>|`, r) || r < 32 {
			return '_'
		}
		return r
	}, s)
	if s == "" {
		s = "character"
	}
	if !strings.HasSuffix(strings.ToLower(s), ext) {
		s += ext
	}
	return s
}

// saveFileAs asks where to save (filter: label + "*"+ext) and writes data there.
// Returns the path, or "" if the user cancelled.
func saveFileAs(suggestedName, label, ext string, data []byte) (string, error) {
	app := application.Get()
	if app == nil {
		return "", errors.New("no application")
	}
	path, err := app.Dialog.SaveFile().
		SetFilename(safeName(suggestedName, ext)).
		AddFilter(label, "*"+ext).
		CanCreateDirectories(true).
		PromptForSingleSelection()
	if err != nil || path == "" {
		return "", err // "" — cancelled
	}
	if filepath.Ext(path) == "" {
		path += ext
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return "", fmt.Errorf("could not save the file: %w", err)
	}
	return path, nil
}
