ALTER TABLE project_users ADD COLUMN known_permissions bigint NOT NULL DEFAULT 0x1F5FFF007FFFFF;
ALTER TABLE api_keys ADD COLUMN known_permissions bigint NOT NULL DEFAULT 0x1F5FFF007FFFFF;

CREATE TEMPORARY TABLE pending_permissions AS
SELECT COALESCE(SUM(bits), 0)::bigint AS bits
FROM (VALUES
    ('schedule_view', 0x200000::bigint),
    ('schedule_manage', 0x400000::bigint),
    ('server_deploy', 0x100000000000::bigint)
) AS backfills (id, bits)
WHERE id NOT IN (SELECT id FROM permission_backfills);

UPDATE project_users SET known_permissions = known_permissions & ~(SELECT bits FROM pending_permissions);
UPDATE api_keys SET known_permissions = known_permissions & ~(SELECT bits FROM pending_permissions);

DROP TABLE pending_permissions;
DROP TABLE permission_backfills;
