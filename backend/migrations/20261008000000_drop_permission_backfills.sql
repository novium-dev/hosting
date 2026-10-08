UPDATE project_users SET permissions = permissions | 0x200000
WHERE permissions & 0x1 = 0x1
  AND NOT EXISTS (SELECT 1 FROM permission_backfills WHERE id = 'schedule_view');
UPDATE api_keys SET permissions = permissions | 0x200000
WHERE permissions & 0x1 = 0x1
  AND NOT EXISTS (SELECT 1 FROM permission_backfills WHERE id = 'schedule_view');

UPDATE project_users SET permissions = permissions | 0x400000
WHERE permissions & 0x2 = 0x2
  AND NOT EXISTS (SELECT 1 FROM permission_backfills WHERE id = 'schedule_manage');
UPDATE api_keys SET permissions = permissions | 0x400000
WHERE permissions & 0x2 = 0x2
  AND NOT EXISTS (SELECT 1 FROM permission_backfills WHERE id = 'schedule_manage');

UPDATE project_users SET permissions = permissions | 0x100000000000
WHERE permissions & 0x100000000 = 0x100000000
  AND NOT EXISTS (SELECT 1 FROM permission_backfills WHERE id = 'server_deploy');
UPDATE api_keys SET permissions = permissions | 0x100000000000
WHERE permissions & 0x100000000 = 0x100000000
  AND NOT EXISTS (SELECT 1 FROM permission_backfills WHERE id = 'server_deploy');

DROP TABLE permission_backfills;
