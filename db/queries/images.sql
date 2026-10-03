-- Queries for the images table (see images.go).
-- Each query starts with a "-- name: QueryName" line (see queries.go).

-- name: InsertImage
INSERT INTO images (id, mime, data) VALUES (?, ?, ?);

-- name: GetImage
SELECT mime, data FROM images WHERE id = ?;

-- name: DeleteOrphanImages
-- Images no record references any more (replaced or deleted along with their record).
DELETE FROM images
WHERE NOT EXISTS (
    SELECT 1 FROM (
        SELECT image AS url FROM races
        UNION ALL SELECT image FROM classes
        UNION ALL SELECT image FROM subclasses
        UNION ALL SELECT image FROM weapons
        UNION ALL SELECT image FROM armor
        UNION ALL SELECT image FROM items
        UNION ALL SELECT image FROM packs
        UNION ALL SELECT portrait FROM characters
        UNION ALL SELECT image FROM monsters
        UNION ALL SELECT portrait FROM campaign_npcs
        UNION ALL SELECT image FROM campaign_locations
        UNION ALL SELECT emblem FROM campaign_factions
    ) WHERE url = '/img/db/' || images.id
);
