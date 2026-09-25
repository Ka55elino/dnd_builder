package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
)

// App struct
type App struct {
	ctx context.Context
	db  *sql.DB
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup opens the database, creates the tables and seeds the reference
// data if it is empty.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	db, err := openDB()
	if err != nil {
		log.Printf("open db: %v", err)
		return
	}
	if err := seedAll(db); err != nil {
		log.Printf("seed db: %v", err)
	}
	a.db = db
}

func (a *App) shutdown(ctx context.Context) {
	if a.db != nil {
		a.db.Close()
	}
}

var errNoDB = errors.New("database is not open")

// GetRaces returns all races with their nested subraces.
func (a *App) GetRaces() ([]Race, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getAllRaces(a.db)
}

// GetClasses returns all classes with their nested subclasses.
func (a *App) GetClasses() ([]Class, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getAllClasses(a.db)
}

// GetEquipment returns weapons, armor, items and packs (is_default = 1 only).
func (a *App) GetEquipment() (Equipment, error) {
	if a.db == nil {
		return Equipment{}, errNoDB
	}
	return getEquipment(a.db)
}

// SaveCharacter saves a character (CharacterBuild JSON) and returns its id.
func (a *App) SaveCharacter(buildJSON string) (string, error) {
	if a.db == nil {
		return "", errNoDB
	}
	return saveCharacter(a.db, buildJSON)
}

// GetCharacter returns a saved character by id (a CharacterBuild object).
func (a *App) GetCharacter(id string) (map[string]any, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getCharacter(a.db, id)
}

// ListCharacters returns all saved characters (summary only).
func (a *App) ListCharacters() ([]CharacterSummary, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return listCharacters(a.db)
}

// GetCharacterState returns the play state (hit points, resources); null if none has been saved yet.
func (a *App) GetCharacterState(id string) (map[string]any, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getCharacterState(a.db, id)
}

// SaveCharacterState saves the play state (CharacterState JSON).
func (a *App) SaveCharacterState(id, stateJSON string) error {
	if a.db == nil {
		return errNoDB
	}
	return saveCharacterState(a.db, id, stateJSON)
}

// GetBackgrounds returns backgrounds (origins).
func (a *App) GetBackgrounds() ([]Background, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getBackgrounds(a.db)
}

// GetFeats returns feats, fighting styles, metamagic options and invocations (by category).
func (a *App) GetFeats() ([]Feat, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getFeats(a.db)
}

// GetSpells returns spells and class/species abilities.
func (a *App) GetSpells() ([]Spell, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getSpells(a.db)
}

// GetCatalog returns all weapons, armor and items (including named ones), for handing out to characters.
func (a *App) GetCatalog() (Catalog, error) {
	if a.db == nil {
		return Catalog{}, errNoDB
	}
	return getCatalog(a.db)
}

// SaveCustomEquipment creates or updates custom equipment.
// kind: weapon | armor | item; itemJSON is an object in db/data format (without an id, a new one is created).
func (a *App) SaveCustomEquipment(kind, itemJSON string) (string, error) {
	if a.db == nil {
		return "", errNoDB
	}
	return saveCustomRecord(a.db, kind, itemJSON)
}

// SaveCustomSpell creates or updates a custom spell (db/data/spells format; without an id, a new one is created).
func (a *App) SaveCustomSpell(spellJSON string) (string, error) {
	if a.db == nil {
		return "", errNoDB
	}
	return saveCustomRecord(a.db, "spell", spellJSON)
}

// DeleteCustomSpell deletes a custom spell (built-in spells cannot be deleted).
func (a *App) DeleteCustomSpell(id string) error {
	if a.db == nil {
		return errNoDB
	}
	return deleteCustomRecord(a.db, "spell", id)
}

// DeleteCustomEquipment deletes custom equipment (built-in equipment cannot be deleted).
func (a *App) DeleteCustomEquipment(kind, id string) error {
	if a.db == nil {
		return errNoDB
	}
	return deleteCustomRecord(a.db, kind, id)
}
