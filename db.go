package main

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

//go:embed db/schema/*.sql
var schemaFS embed.FS

func appDataDir() (string, error) {
	base, err := os.UserConfigDir()

	if err != nil {
		return "", err
	}

	dir := filepath.Join(base, APP_NAME)

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}

	return dir, nil
}

// dbFileName — отдельный файл для dev, чтобы не затирать рабочую БД.
func dbFileName() string {
	if devMode {
		return "dnd-dev.db"
	}
	return "dnd.db"
}

// removeDB удаляет файл БД вместе с WAL/SHM (если их нет — не ошибка).
func removeDB(path string) error {
	for _, p := range []string{path, path + "-wal", path + "-shm"} {
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func openDB() (db *sql.DB, err error) {
	dir, err := appDataDir()
	if err != nil {
		return nil, err
	}

	path := filepath.Join(dir, dbFileName())

	if devMode {
		// dev: всегда чистая БД — схема и сиды применяются заново
		if err := removeDB(path); err != nil {
			return nil, err
		}
		log.Printf("[dev] БД пересоздана: %s", path)
	}

	db, err = sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}

	for _, p := range []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA foreign_keys = ON;",
		"PRAGMA busy_timeout = 5000;",
	} {
		if _, err := db.Exec(p); err != nil {
			db.Close()
			return nil, err
		}
	}

	if err := initSchema(db); err != nil {
		db.Close()
		return nil, err
	}

	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func initSchema(db *sql.DB) error {
	files, err := fs.Glob(schemaFS, "db/schema/*.sql")

	if err != nil {
		return err
	}

	for _, f := range files {
		b, err := schemaFS.ReadFile(f)
		if err != nil {
			return err
		}

		if _, err := db.Exec(string(b)); err != nil {
			return fmt.Errorf("%s: %w", f, err)
		}
	}

	return nil
}

// migrate — изменения схемы для уже существующих БД
// (CREATE TABLE IF NOT EXISTS не добавляет новые колонки в старую таблицу).
func migrate(db *sql.DB) error {
	// Колонка image: если её пришлось добавить, справочные записи были
	// загружены без картинок — удаляем их, seedAll загрузит заново из JSON.
	// Пользовательские (is_custom = 1) не трогаем.
	// Порядок важен: subclasses раньше classes (внешний ключ).
	for _, table := range []string{"races", "subclasses", "classes"} {
		added, err := ensureColumn(db, table, "image", "TEXT")
		if err != nil {
			return err
		}
		if added {
			if _, err := db.Exec(fmt.Sprintf("DELETE FROM %s WHERE is_custom = 0", table)); err != nil {
				return err
			}
		}
	}
	// state_json у персонажей — просто добавляем, данные не трогаем
	if _, err := ensureColumn(db, "characters", "state_json", "TEXT"); err != nil {
		return err
	}
	// своё снаряжение (страница «Предметы») — is_custom и даты у старых таблиц
	for _, table := range []string{"weapons", "armor", "items"} {
		if _, err := ensureColumn(db, table, "is_custom", "INTEGER NOT NULL DEFAULT 0"); err != nil {
			return err
		}
	}
	return nil
}

// ensureColumn добавляет колонку, если её нет. Возвращает true, если добавила.
func ensureColumn(db *sql.DB, table, column, def string) (bool, error) {
	rows, err := db.Query(fmt.Sprintf("SELECT name FROM pragma_table_info('%s')", table))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return false, err
		}
		if name == column {
			return false, nil
		}
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	rows.Close()

	_, err = db.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, def))
	return err == nil, err
}
