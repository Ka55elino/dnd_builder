package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

// User-defined reference records: items, armor and weapons
// (the "Items" page), spells (the "Spells" page), monsters (the "Bestiary" page)
// and conditions (the "Conditions" page).
// They are stored in the same tables as the built-in records, with is_custom = 1
// and "custom": true in data (so the frontend can tell them apart).
// Built-in records (is_custom = 0) are never modified or deleted by these methods.

type customKind struct {
	table     string
	insert    func(*sql.Tx, []byte) error // the same JSON insert as used by the seeders
	equipment bool                        // equipment: isDefault = false (not in the builder's starting choices)
	children  []string                    // related tables (spell_id), cleared on replace/delete
}

var customKinds = map[string]customKind{
	"weapon":  {table: "weapons", insert: insertWeaponJSON, equipment: true},
	"armor":   {table: "armor", insert: insertArmorJSON, equipment: true},
	"item":    {table: "items", insert: insertItemJSON, equipment: true},
	"spell":   {table: "spells", insert: insertSpellJSON, children: []string{"spell_classes"}},
	"monster": {table: "monsters", insert: insertMonsterJSON},
	// conditions and named effects (the "Conditions" page): Frozen, a custom curse…
	"condition": {table: "conditions", insert: insertConditionJSON},
}

// deleteChildren deletes a record's rows in related tables (e.g. spell_classes).
func deleteChildren(tx *sql.Tx, k customKind, id string) error {
	for _, t := range k.children {
		if _, err := tx.Exec(fmt.Sprintf("DELETE FROM %s WHERE spell_id = ?", t), id); err != nil {
			return err
		}
	}
	return nil
}

var errNotCustom = errors.New("this is a built-in record and cannot be modified or deleted")

func newCustomID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "custom_" + hex.EncodeToString(b)
}

// isCustomRow reports whether a record with this id exists and whether it is user-defined.
func isCustomRow(tx *sql.Tx, table, id string) (exists, custom bool, err error) {
	var c int
	err = tx.QueryRow(fmt.Sprintf("SELECT is_custom FROM %s WHERE id = ?", table), id).Scan(&c)
	if errors.Is(err, sql.ErrNoRows) {
		return false, false, nil
	}
	return err == nil, c == 1, err
}

// saveCustomRecord creates or updates a user-defined record and returns its id.
func saveCustomRecord(db *sql.DB, kind, raw string) (string, error) {
	k, ok := customKinds[kind]
	if !ok {
		return "", fmt.Errorf("unknown record kind: %q", kind)
	}

	var obj map[string]any
	if err := json.Unmarshal([]byte(raw), &obj); err != nil {
		return "", err
	}
	id, _ := obj["id"].(string)
	if id == "" {
		id = newCustomID()
	}
	obj["id"] = id
	obj["custom"] = true
	if k.equipment {
		obj["isDefault"] = false // custom equipment is not included in the builder's starting choices
	}
	tx, err := db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	// an uploaded image (data URL) goes to the images table, the record keeps its /img/db/ URL
	if err := storeImageField(tx, obj, "image"); err != nil {
		return "", err
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return "", err
	}

	exists, custom, err := isCustomRow(tx, k.table, id)
	if err != nil {
		return "", err
	}
	if exists && !custom {
		return "", errNotCustom
	}
	var created any = nil
	if exists {
		// keep the creation date on update
		var c int64
		if err := tx.QueryRow(fmt.Sprintf("SELECT created_at FROM %s WHERE id = ?", k.table), id).Scan(&c); err != nil {
			return "", err
		}
		created = c
		if err := deleteChildren(tx, k, id); err != nil {
			return "", err
		}
		if _, err := tx.Exec(fmt.Sprintf("DELETE FROM %s WHERE id = ?", k.table), id); err != nil {
			return "", err
		}
	}
	if err := k.insert(tx, b); err != nil {
		return "", err
	}
	if _, err := tx.Exec(fmt.Sprintf(
		"UPDATE %s SET is_custom = 1, created_at = COALESCE(?, created_at), updated_at = strftime('%%s','now') WHERE id = ?",
		k.table), created, id); err != nil {
		return "", err
	}
	return id, tx.Commit()
}

// deleteCustomRecord deletes a user-defined record (and its related rows).
func deleteCustomRecord(db *sql.DB, kind, id string) error {
	k, ok := customKinds[kind]
	if !ok {
		return fmt.Errorf("unknown record kind: %q", kind)
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	exists, custom, err := isCustomRow(tx, k.table, id)
	if err != nil {
		return err
	}
	if !exists || !custom {
		return errNotCustom
	}
	if err := deleteChildren(tx, k, id); err != nil {
		return err
	}
	if _, err := tx.Exec(fmt.Sprintf("DELETE FROM %s WHERE id = ? AND is_custom = 1", k.table), id); err != nil {
		return err
	}
	return tx.Commit()
}
