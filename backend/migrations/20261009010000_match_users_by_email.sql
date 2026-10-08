UPDATE users SET email = lower(trim(email));

DO $$
BEGIN
    IF EXISTS (SELECT email FROM users GROUP BY email HAVING COUNT(*) > 1) THEN
        RAISE EXCEPTION 'Several users share an email address; merge or change them before migrating';
    END IF;
END
$$;

ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE users DROP CONSTRAINT users_auth_id_key;
