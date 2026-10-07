ALTER TABLE project_users ADD COLUMN known_permissions bigint NOT NULL DEFAULT 8831273107718143;
ALTER TABLE api_keys ADD COLUMN known_permissions bigint NOT NULL DEFAULT 8831273107718143;

CREATE TEMPORARY TABLE pending_permissions AS
SELECT COALESCE(SUM(bits), 0)::bigint AS bits
FROM (VALUES
    ('schedule_view', 2097152::bigint),
    ('schedule_manage', 4194304::bigint),
    ('server_deploy', 17592186044416::bigint)
) AS backfills (id, bits)
WHERE id NOT IN (SELECT id FROM permission_backfills);

UPDATE project_users SET known_permissions = known_permissions & ~(SELECT bits FROM pending_permissions);
UPDATE api_keys SET known_permissions = known_permissions & ~(SELECT bits FROM pending_permissions);

DROP TABLE pending_permissions;
DROP TABLE permission_backfills;
