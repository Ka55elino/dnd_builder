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

// startup: открываем БД, создаём таблицы и заполняем справочники,
// если они пустые.
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

var errNoDB = errors.New("база данных не открыта")

// GetRaces — все расы с вложенными подрасами.
func (a *App) GetRaces() ([]Race, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getAllRaces(a.db)
}

// GetClasses — все классы с вложенными подклассами.
func (a *App) GetClasses() ([]Class, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getAllClasses(a.db)
}

// GetEquipment — оружие, доспехи, предметы и наборы (только is_default = 1).
func (a *App) GetEquipment() (Equipment, error) {
	if a.db == nil {
		return Equipment{}, errNoDB
	}
	return getEquipment(a.db)
}

// SaveCharacter — сохранить персонажа (JSON CharacterBuild). Возвращает id.
func (a *App) SaveCharacter(buildJSON string) (string, error) {
	if a.db == nil {
		return "", errNoDB
	}
	return saveCharacter(a.db, buildJSON)
}

// GetCharacter — сохранённый персонаж по id (объект CharacterBuild).
func (a *App) GetCharacter(id string) (map[string]any, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getCharacter(a.db, id)
}

// ListCharacters — все сохранённые персонажи (кратко).
func (a *App) ListCharacters() ([]CharacterSummary, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return listCharacters(a.db)
}

// GetCharacterState — игровое состояние (хиты, ресурсы). null — ещё не было.
func (a *App) GetCharacterState(id string) (map[string]any, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getCharacterState(a.db, id)
}

// SaveCharacterState — сохранить игровое состояние (JSON CharacterState).
func (a *App) SaveCharacterState(id, stateJSON string) error {
	if a.db == nil {
		return errNoDB
	}
	return saveCharacterState(a.db, id, stateJSON)
}

// GetBackgrounds — предыстории (происхождения).
func (a *App) GetBackgrounds() ([]Background, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getBackgrounds(a.db)
}

// GetFeats — черты, боевые стили, метамагия, воззвания (по category).
func (a *App) GetFeats() ([]Feat, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getFeats(a.db)
}

// GetSpells — заклинания и классовые/расовые способности.
func (a *App) GetSpells() ([]Spell, error) {
	if a.db == nil {
		return nil, errNoDB
	}
	return getSpells(a.db)
}

// GetCatalog — всё оружие, доспехи и предметы (включая именные) — для выдачи.
func (a *App) GetCatalog() (Catalog, error) {
	if a.db == nil {
		return Catalog{}, errNoDB
	}
	return getCatalog(a.db)
}

// SaveCustomEquipment — создать/обновить своё снаряжение.
// kind: weapon | armor | item; itemJSON — объект в формате db/data (без id — создаст новый).
func (a *App) SaveCustomEquipment(kind, itemJSON string) (string, error) {
	if a.db == nil {
		return "", errNoDB
	}
	return saveCustomRecord(a.db, kind, itemJSON)
}

// SaveCustomSpell — создать/обновить своё заклинание (формат db/data/spells; без id — новое).
func (a *App) SaveCustomSpell(spellJSON string) (string, error) {
	if a.db == nil {
		return "", errNoDB
	}
	return saveCustomRecord(a.db, "spell", spellJSON)
}

// DeleteCustomSpell — удалить своё заклинание (справочное удалить нельзя).
func (a *App) DeleteCustomSpell(id string) error {
	if a.db == nil {
		return errNoDB
	}
	return deleteCustomRecord(a.db, "spell", id)
}

// DeleteCustomEquipment — удалить своё снаряжение (справочное удалить нельзя).
func (a *App) DeleteCustomEquipment(kind, id string) error {
	if a.db == nil {
		return errNoDB
	}
	return deleteCustomRecord(a.db, kind, id)
}
