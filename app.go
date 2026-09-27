package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"dnd-builder-v3/lan"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// App is the backend service: its exported methods are bound to the frontend
// (see main.go and frontend/src/api.js).
type App struct {
	ctx     context.Context
	db      *sql.DB
	ready   chan struct{} // closed once the DB is open and seeded (or failed to open)
	initErr error
	net     *lan.Manager // local-network game (net.go)
}

// NewApp creates the backend service.
func NewApp() *App {
	return &App{ready: make(chan struct{}), net: lan.NewManager(emitEvent)}
}

// ServiceStartup (called by Wails before the window loads) opens the database
// in the background: the window and the frontend loader show up immediately,
// and bound methods wait for the DB to be ready.
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.ctx = ctx
	go a.initDB()
	return nil
}

// initDB opens the database, creates the tables and seeds the reference
// data if it is empty.
func (a *App) initDB() {
	defer close(a.ready)

	db, err := openDB()
	if err != nil {
		log.Printf("open db: %v", err)
		a.initErr = err
		return
	}
	if err := seedAll(db); err != nil {
		log.Printf("seed db: %v", err)
	}
	if err := migrateInlineImages(db); err != nil {
		log.Printf("migrate images: %v", err)
	}
	deleteOrphanImages(db)
	a.db = db
}

// ServiceShutdown (called by Wails on exit) closes the database.
func (a *App) ServiceShutdown() error {
	a.net.Close()
	select {
	case <-a.ready:
		if a.db != nil {
			a.db.Close()
		}
	default: // still seeding — the process is exiting anyway
	}
	return nil
}

// conn waits until the DB is ready and returns it.
func (a *App) conn() (*sql.DB, error) {
	<-a.ready
	if a.db == nil {
		return nil, fmt.Errorf("database is not open: %v", a.initErr)
	}
	return a.db, nil
}

// Ready blocks until the database is open and seeded; the frontend waits for it
// behind the startup loader.
func (a *App) Ready() error {
	_, err := a.conn()
	return err
}

// GetRaces returns all races with their nested subraces.
func (a *App) GetRaces() ([]Race, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getAllRaces(db)
}

// GetClasses returns all classes with their nested subclasses.
func (a *App) GetClasses() ([]Class, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getAllClasses(db)
}

// GetEquipment returns weapons, armor, items and packs (is_default = 1 only).
func (a *App) GetEquipment() (Equipment, error) {
	db, err := a.conn()
	if err != nil {
		return Equipment{}, err
	}
	return getEquipment(db)
}

// SaveCharacter saves a character (CharacterBuild JSON) and returns its id.
func (a *App) SaveCharacter(buildJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	return saveCharacter(db, buildJSON)
}

// GetCharacter returns a saved character by id (a CharacterBuild object).
func (a *App) GetCharacter(id string) (map[string]any, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getCharacter(db, id)
}

// ListCharacters returns all saved characters (summary only).
func (a *App) ListCharacters() ([]CharacterSummary, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return listCharacters(db)
}

// GetCharacterState returns the play state (hit points, resources); null if none has been saved yet.
func (a *App) GetCharacterState(id string) (map[string]any, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getCharacterState(db, id)
}

// SaveCharacterState saves the play state (CharacterState JSON).
func (a *App) SaveCharacterState(id, stateJSON string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	return saveCharacterState(db, id, stateJSON)
}

// GetBackgrounds returns backgrounds (origins).
func (a *App) GetBackgrounds() ([]Background, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getBackgrounds(db)
}

// GetFeats returns feats, fighting styles, metamagic options and invocations (by category).
func (a *App) GetFeats() ([]Feat, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getFeats(db)
}

// GetSpells returns spells and class/species abilities.
func (a *App) GetSpells() ([]Spell, error) {
	db, err := a.conn()
	if err != nil {
		return nil, err
	}
	return getSpells(db)
}

// GetCatalog returns all weapons, armor and items (including named ones), for handing out to characters.
func (a *App) GetCatalog() (Catalog, error) {
	db, err := a.conn()
	if err != nil {
		return Catalog{}, err
	}
	return getCatalog(db)
}

// SaveCustomEquipment creates or updates custom equipment.
// kind: weapon | armor | item; itemJSON is an object in assets/data format (without an id, a new one is created).
func (a *App) SaveCustomEquipment(kind, itemJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	return saveCustomRecord(db, kind, itemJSON)
}

// SaveCustomSpell creates or updates a custom spell (assets/data/spells format; without an id, a new one is created).
func (a *App) SaveCustomSpell(spellJSON string) (string, error) {
	db, err := a.conn()
	if err != nil {
		return "", err
	}
	return saveCustomRecord(db, "spell", spellJSON)
}

// DeleteCustomSpell deletes a custom spell (built-in spells cannot be deleted).
func (a *App) DeleteCustomSpell(id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	return deleteCustomRecord(db, "spell", id)
}

// DeleteCustomEquipment deletes custom equipment (built-in equipment cannot be deleted).
func (a *App) DeleteCustomEquipment(kind, id string) error {
	db, err := a.conn()
	if err != nil {
		return err
	}
	return deleteCustomRecord(db, kind, id)
}
