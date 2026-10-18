-- CallFlow: Transcript feature migration
-- Adds a call_transcripts table for audio transcription storage.
-- Run this on your Supabase project via the SQL editor or dashboard.
-- For SQLite local dev, this is applied automatically by db.init_db().

-- Enable extensions (already done in schema.sql, kept here for standalone runs)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Transcripts table: one record per call (upsert on retry)
CREATE TABLE IF NOT EXISTS call_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    -- Transcription lifecycle status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    -- Original unedited text from the speech-to-text provider
    raw_transcript TEXT,
    -- User-edited version (preserved separately from raw)
    edited_transcript TEXT,
    -- Optional provider metadata (timestamps, speaker labels if available)
    transcript_metadata JSONB,
    -- Error message when status = 'failed'
    error_message TEXT,
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    -- One transcript record per call (replaced on retry)
    CONSTRAINT uq_call_transcript UNIQUE (call_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transcripts_call_id ON call_transcripts (call_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_status ON call_transcripts (status);

-- RLS (same pattern as existing tables)
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access to transcripts" ON call_transcripts;
CREATE POLICY "Allow service role full access to transcripts"
    ON call_transcripts FOR ALL
    USING (true)
    WITH CHECK (true);
