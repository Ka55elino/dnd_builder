-- App metadata: key → value.
--   data_version — the app version whose built-in reference data is in the database
--                  (seed.go: another app version refreshes the built-in rows, user rows stay).
CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
