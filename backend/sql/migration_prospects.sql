-- CallFlow Migration: Prospects
-- Stores searchable prospects list seeded from the 100 cold-call transcripts
-- and user-added prospects.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS prospects (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    contact_name TEXT,
    phone_number TEXT,
    context TEXT,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Case-insensitive unique index on company_name to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uq_prospects_company_name_lower ON prospects (LOWER(TRIM(company_name)));

-- Additional indexes for search and ordering
CREATE INDEX IF NOT EXISTS idx_prospects_company_name ON prospects (company_name);
CREATE INDEX IF NOT EXISTS idx_prospects_created_at ON prospects (created_at DESC);

-- Row Level Security
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access to prospects" ON prospects;
CREATE POLICY "Allow service role full access to prospects"
    ON prospects FOR ALL
    USING (true)
    WITH CHECK (true);
