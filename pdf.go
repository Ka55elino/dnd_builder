package main

import (
	"encoding/json"
	"fmt"
)

// The character sheet PDF (pdf_render.go): the frontend sends the print model
// (frontend/src/pdfSheet.js) as JSON, Go renders it and saves / shares the file.

func sheetPDFBytes(modelJSON string) ([]byte, error) {
	var m SheetModel
	if err := json.Unmarshal([]byte(modelJSON), &m); err != nil {
		return nil, fmt.Errorf("bad sheet data: %w", err)
	}
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
