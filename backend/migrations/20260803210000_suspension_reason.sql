ALTER TABLE servers ADD COLUMN suspension_reason varchar(512);

UPDATE servers
SET suspension_reason = 'Suspended before reasons were required'
WHERE suspended;

ALTER TABLE servers ADD CONSTRAINT servers_suspension_reason_check CHECK (
    (suspended AND suspension_reason IS NOT NULL)
    OR (NOT suspended AND suspension_reason IS NULL)
);
