ALTER TABLE route_domains
    ADD COLUMN IF NOT EXISTS cloudflare_zone_id varchar(64);
