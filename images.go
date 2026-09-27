package main

import (
	"crypto/rand"
	"database/sql"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"strings"
)

// Images are served by URL instead of being sent to the frontend as base64:
//
//	/img/<path>    — built-in images, files in assets/images embedded into the binary
//	                 (the JSON in assets/data stores "image": "/img/races/elf/elf.png")
//	/img/db/<id>   — user-uploaded images from the images table
//
// The frontend just uses <img src={x.image}>. A data URL in an image field
// still renders, and it is moved into the images table when the record is saved.

//go:embed all:assets/images
var imagesFS embed.FS

const (
	imgPrefix   = "/img/"
	dbImgPrefix = "/img/db/"
)

var builtinImages = func() http.Handler {
	sub, err := fs.Sub(imagesFS, "assets/images")
	if err != nil {
		panic(err)
	}
	return http.StripPrefix(imgPrefix, http.FileServer(http.FS(sub)))
}()

// imageMiddleware serves /img/… before the frontend assets (and the Vite dev server in `wails dev`).
func (a *App) imageMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, imgPrefix) {
			next.ServeHTTP(w, r)
			return
		}
		if id, ok := strings.CutPrefix(r.URL.Path, dbImgPrefix); ok {
			a.serveDBImage(w, id)
			return
		}
		// built-in files may be replaced between `wails dev` restarts: revalidate
		w.Header().Set("Cache-Control", "no-cache")
		builtinImages.ServeHTTP(w, r)
	})
}

func (a *App) serveDBImage(w http.ResponseWriter, id string) {
	db, err := a.conn()
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	var (
		mime string
		data []byte
	)
	err = db.QueryRow(Q("GetImage"), id).Scan(&mime, &data)
	if errors.Is(err, sql.ErrNoRows) {
		http.NotFound(w, nil)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable") // an id's content never changes
	_, _ = w.Write(data)
}

// storeImage turns a data URL into a row in the images table and returns its /img/db/ URL.
// Anything else (an /img/ URL, "") is returned unchanged.
func storeImage(db execer, s string) (string, error) {
	if !strings.HasPrefix(s, "data:") {
		return s, nil
	}
	mime, data, err := parseDataURL(s)
	if err != nil {
		return "", err
	}
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	id := "img_" + hex.EncodeToString(b)
	if _, err := db.Exec(Q("InsertImage"), id, mime, data); err != nil {
		return "", err
	}
	return dbImgPrefix + id, nil
}

// storeImageField applies storeImage to obj[key] if it is a string.
func storeImageField(db execer, obj map[string]any, key string) error {
	s, ok := obj[key].(string)
	if !ok {
		return nil
	}
	u, err := storeImage(db, s)
	if err != nil {
		return fmt.Errorf("%s: %w", key, err)
	}
	obj[key] = u
	return nil
}

// parseDataURL: "data:image/png;base64,AAAA" | "data:image/svg+xml;utf8,<svg…" → mime, bytes.
func parseDataURL(s string) (string, []byte, error) {
	head, body, ok := strings.Cut(strings.TrimPrefix(s, "data:"), ",")
	if !ok {
		return "", nil, errors.New("invalid data URL")
	}
	params := strings.Split(head, ";")
	mime := params[0]
	if !strings.HasPrefix(mime, "image/") {
		return "", nil, fmt.Errorf("not an image: %q", mime)
	}
	for _, p := range params[1:] {
		if p == "base64" {
			data, err := base64.StdEncoding.DecodeString(body)
			return mime, data, err
		}
	}
	text, err := url.PathUnescape(body)
	return mime, []byte(text), err
}

// deleteOrphanImages removes uploaded images no record references any more.
func deleteOrphanImages(db *sql.DB) {
	res, err := db.Exec(Q("DeleteOrphanImages"))
	if err != nil {
		log.Printf("delete orphan images: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("deleted %d unused images", n)
	}
}

// Tables with an image column (see also DeleteOrphanImages).
var imageTables = []string{"races", "classes", "subclasses", "weapons", "armor", "items", "packs"}

// migrateInlineImages moves data URLs left in an existing DB (from before images.go)
// into the images table, so every record references its image by URL.
func migrateInlineImages(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	n := 0
	for _, t := range imageTables {
		rows, err := tx.Query(fmt.Sprintf("SELECT id, image FROM %s WHERE image LIKE 'data:%%'", t))
		if err != nil {
			return err
		}
		type row struct{ id, image string }
		var list []row
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.id, &r.image); err != nil {
				rows.Close()
				return err
			}
			list = append(list, r)
		}
		rows.Close()
		for _, r := range list {
			u, err := storeImage(tx, r.image)
			if err != nil {
				return fmt.Errorf("%s %s: %w", t, r.id, err)
			}
			if _, err := tx.Exec(fmt.Sprintf("UPDATE %s SET image = ? WHERE id = ?", t), u, r.id); err != nil {
				return err
			}
			n++
		}
	}

	// characters: the portrait is both a column and a field of build_json
	rows, err := tx.Query("SELECT id, build_json FROM characters WHERE portrait LIKE 'data:%'")
	if err != nil {
		return err
	}
	type char struct{ id, build string }
	var chars []char
	for rows.Next() {
		var c char
		if err := rows.Scan(&c.id, &c.build); err != nil {
			rows.Close()
			return err
		}
		chars = append(chars, c)
	}
	rows.Close()
	for _, c := range chars {
		if _, err := saveCharacter(tx, c.build); err != nil {
			return fmt.Errorf("character %s: %w", c.id, err)
		}
		n++
	}

	if n > 0 {
		log.Printf("moved %d inline images into the images table", n)
	}
	return tx.Commit()
}
