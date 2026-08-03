CREATE TABLE regions (
    id char(6) PRIMARY KEY,
    display varchar(64) NOT NULL,
    slug varchar(64) NOT NULL UNIQUE
);

INSERT INTO regions (id, display, slug)
SELECT 'defalt', 'Default', 'default'
WHERE EXISTS (SELECT 1 FROM nodes);

ALTER TABLE nodes ADD COLUMN region char(6) REFERENCES regions (id);

UPDATE nodes SET region = 'defalt' WHERE region IS NULL;

ALTER TABLE nodes ALTER COLUMN region SET NOT NULL;

CREATE INDEX nodes_region_idx ON nodes (region);
