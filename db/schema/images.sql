-- User-uploaded images (portraits, images of custom species/classes/items).
-- Records reference them as "/img/db/<id>" in their image/portrait fields;
-- built-in images are files in assets/images, referenced as "/img/<path>".
-- An image is never changed: a new upload gets a new id; unreferenced ones
-- are deleted on startup (DeleteOrphanImages).
CREATE TABLE IF NOT EXISTS images (
    id         TEXT PRIMARY KEY,                -- 'img_xxxx'
    mime       TEXT NOT NULL,                   -- 'image/png' | 'image/jpeg' | …
    data       BLOB NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
