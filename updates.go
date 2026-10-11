package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Updates: the app asks GitHub for the latest release of GITHUB_REPO (public API, no token)
// and the footer offers "Update" if it is newer (frontend: AppFooter.svelte, at most once a
// day, on launch). Nothing is downloaded or installed here — "Update" opens the release file
// for this platform in the browser; the user installs it as usual. The database survives
// the update (one dnd.db for every version, see db.go / seed.go).
//
// /releases/latest skips drafts and pre-releases (v0.6.0-beta.1 is never offered).

// UpdateInfo is the answer of CheckForUpdate.
type UpdateInfo struct {
	Current     string `json:"current"`     // APP_VERSION
	Latest      string `json:"latest"`      // the latest release ("0.5.3"), "" — unknown
	Available   bool   `json:"available"`   // Latest is newer than Current
	Name        string `json:"name"`        // the release title
	Notes       string `json:"notes"`       // the release notes (markdown)
	PageURL     string `json:"pageUrl"`     // the release page
	DownloadURL string `json:"downloadUrl"` // this platform's file; "" — use PageURL
}

// CheckForUpdate asks GitHub for the latest release. Network errors are returned (the
// frontend just shows nothing).
func (a *App) CheckForUpdate() (UpdateInfo, error) {
	info := UpdateInfo{Current: APP_VERSION}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.github.com/repos/"+GITHUB_REPO+"/releases/latest", nil)
	if err != nil {
		return info, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", APP_NAME+"/"+APP_VERSION) // GitHub's API requires one
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return info, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return info, fmt.Errorf("github: %s", res.Status)
	}
	var rel struct {
		TagName string `json:"tag_name"`
		Name    string `json:"name"`
		Body    string `json:"body"`
		HTMLURL string `json:"html_url"`
		Assets  []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(res.Body).Decode(&rel); err != nil {
		return info, err
	}
	info.Latest = strings.TrimPrefix(rel.TagName, "v")
	info.Name = rel.Name
	info.Notes = rel.Body
	info.PageURL = rel.HTMLURL
	info.Available = newerVersion(info.Latest, APP_VERSION)
	for _, suffix := range platformAssets() {
		for _, as := range rel.Assets {
			if strings.HasSuffix(as.Name, suffix) {
				info.DownloadURL = as.URL
				break
			}
		}
		if info.DownloadURL != "" {
			break
		}
	}
	return info, nil
}

// platformAssets: the release file names for this platform, best first (release.yml builds them).
func platformAssets() []string {
	switch runtime.GOOS {
	case "darwin":
		return []string{"-macos-universal.zip"}
	case "windows":
		return []string{"-windows-amd64-installer.exe", "-windows-amd64.zip"}
	case "linux":
		return []string{"-linux-amd64.tar.gz"}
	case "android":
		return []string{"-android.apk"}
	}
	return nil // iOS (no installable file), others: the release page
}

var semverRe = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)`)

// newerVersion: a > b, by major.minor.patch (a suffix like "-beta.1" is ignored).
func newerVersion(a, b string) bool {
	pa, pb := semverRe.FindStringSubmatch(a), semverRe.FindStringSubmatch(b)
	if pa == nil || pb == nil {
		return false
	}
	for i := 1; i <= 3; i++ {
		x, _ := strconv.Atoi(pa[i])
		y, _ := strconv.Atoi(pb[i])
		if x != y {
			return x > y
		}
	}
	return false
}
