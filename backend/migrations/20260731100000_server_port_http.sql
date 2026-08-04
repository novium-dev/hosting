ALTER TABLE server_ports
    ADD COLUMN IF NOT EXISTS http boolean NOT NULL DEFAULT false;
