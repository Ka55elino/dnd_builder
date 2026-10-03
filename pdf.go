package main

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
)

// The character sheet PDF (pdf_render.go): the frontend sends the print model
// (frontend/src/pdfSheet.js) as JSON, Go renders it and saves / shares the file.

func sheetPDFBytes(modelJSON string) (out []byte, err error) {
	var m SheetModel
	if err := json.Unmarshal([]byte(modelJSON), &m); err != nil {
		return nil, fmt.Errorf("bad sheet data: %w", err)
	}
	pdfSafe(reflect.ValueOf(&m))
	// fpdf panics on things it can't draw — an error, not a crash
	defer func() {
		if r := recover(); r != nil {
			out, err = nil, fmt.Errorf("could not make the PDF: %v", r)
		}
	}()
	b, err := renderSheetPDF(&m)
	if err != nil {
		return nil, fmt.Errorf("could not make the PDF: %w", err)
	}
	return b, nil
}

// SaveCharacterPDF renders the sheet and asks where to save it.
// Returns the path, or "" if the user cancelled.
func (a *App) SaveCharacterPDF(suggestedName, modelJSON string) (string, error) {
	b, err := sheetPDFBytes(modelJSON)
	if err != nil {
		return "", err
	}
	return saveFileAs(suggestedName, "PDF", ".pdf", b)
}

// pdfText drops what the PDF fonts can't hold: fpdf's UTF-8 fonts map only the Basic
// Multilingual Plane (runes up to U+FFFF) — an emoji (🐾, ⚔️…) indexes past its tables and
// panics. Also the invisible emoji glue (variation selectors, zero-width joiner).
func pdfText(s string) string {
	clean := true
	for _, r := range s {
		if r > 0xFFFF || r == 0xFE0F || r == 0xFE0E || r == 0x200D {
			clean = false
			break
		}
	}
	if clean {
		return s
	}
	var b strings.Builder
	for _, r := range s {
		if r > 0xFFFF || r == 0xFE0F || r == 0xFE0E || r == 0x200D {
			continue
		}
		b.WriteRune(r)
	}
	out := b.String()
	for strings.Contains(out, "  ") { // "🐾 Wolf" → "Wolf", "a 🐾 b" → "a b"; line breaks stay
		out = strings.ReplaceAll(out, "  ", " ")
	}
	return strings.TrimSpace(out)
}

// pdfSafe runs pdfText over every string in the model (fields, slices, maps). The portrait
// (a data URL) is plain ASCII, so it passes untouched.
func pdfSafe(v reflect.Value) {
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface:
		if !v.IsNil() {
			pdfSafe(v.Elem())
		}
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if v.Type().Field(i).IsExported() {
				pdfSafe(v.Field(i))
			}
		}
	case reflect.Slice, reflect.Array:
		for i := 0; i < v.Len(); i++ {
			pdfSafe(v.Index(i))
		}
	case reflect.Map:
		for _, k := range v.MapKeys() {
			e := v.MapIndex(k)
			if e.Kind() == reflect.String {
				v.SetMapIndex(k, reflect.ValueOf(pdfText(e.String())).Convert(e.Type()))
			}
		}
	case reflect.String:
		if v.CanSet() {
			v.SetString(pdfText(v.String()))
		}
	}
}
