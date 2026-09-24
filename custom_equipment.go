package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

// Пользовательские записи справочников: предметы, доспехи и оружие
// (страница «Предметы») и заклинания (страница «Заклинания»).
// Хранятся в тех же таблицах, что и справочные, с is_custom = 1 и полем
// "custom": true в data (чтобы фронтенд их отличал).
// Справочные записи (is_custom = 0) этими методами не меняются и не удаляются.

type customKind struct {
	table     string
	insert    func(*sql.Tx, []byte) error // та же вставка из JSON, что у сидов
	equipment bool                        // снаряжение: isDefault = false (не в стартовом выборе билдера)
	children  []string                    // связанные таблицы (spell_id) — чистим при замене/удалении
}

var customKinds = map[string]customKind{
	"weapon": {table: "weapons", insert: insertWeaponJSON, equipment: true},
	"armor":  {table: "armor", insert: insertArmorJSON, equipment: true},
	"item":   {table: "items", insert: insertItemJSON, equipment: true},
	"spell":  {table: "spells", insert: insertSpellJSON, children: []string{"spell_classes"}},
}

// deleteChildren — строки связанных таблиц (напр. spell_classes) для записи.
func deleteChildren(tx *sql.Tx, k customKind, id string) error {
	for _, t := range k.children {
		if _, err := tx.Exec(fmt.Sprintf("DELETE FROM %s WHERE spell_id = ?", t), id); err != nil {
			return err
		}
	}
	return nil
}

var errNotCustom = errors.New("это справочная запись — её нельзя изменить или удалить")

func newCustomID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "custom_" + hex.EncodeToString(b)
}

// isCustomRow: exists — есть ли запись с таким id; custom — пользовательская ли она.
func isCustomRow(tx *sql.Tx, table, id string) (exists, custom bool, err error) {
	var c int
	err = tx.QueryRow(fmt.Sprintf("SELECT is_custom FROM %s WHERE id = ?", table), id).Scan(&c)
	if errors.Is(err, sql.ErrNoRows) {
		return false, false, nil
	}
	return err == nil, c == 1, err
}

// saveCustomRecord создаёт или обновляет пользовательскую запись. Возвращает её id.
func saveCustomRecord(db *sql.DB, kind, raw string) (string, error) {
	k, ok := customKinds[kind]
	if !ok {
		return "", fmt.Errorf("неизвестный вид записи: %q", kind)
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
		obj["isDefault"] = false // своё снаряжение не попадает в стартовый выбор билдера
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return "", err
	}

	tx, err := db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	exists, custom, err := isCustomRow(tx, k.table, id)
	if err != nil {
		return "", err
	}
	if exists && !custom {
		return "", errNotCustom
	}
	var created any = nil
	if exists {
		// сохраняем дату создания при обновлении
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

// deleteCustomRecord удаляет пользовательскую запись (и её связанные строки).
func deleteCustomRecord(db *sql.DB, kind, id string) error {
	k, ok := customKinds[kind]
	if !ok {
		return fmt.Errorf("неизвестный вид записи: %q", kind)
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
