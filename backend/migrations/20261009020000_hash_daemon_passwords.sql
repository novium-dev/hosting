ALTER TABLE users
    ALTER COLUMN daemon_password TYPE char(64)
    USING encode(sha256(convert_to(daemon_password, 'UTF8')), 'hex');
