-- CallFlow PostgreSQL / Supabase Schema
-- Stores call records, stage-by-stage outcomes, verbatim prospect notes, and completion details.

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Calls table
CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name TEXT NOT NULL,
    contact_name TEXT,
    phone_number TEXT,
    context TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
    current_stage INTEGER NOT NULL DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 8),
    highest_stage INTEGER NOT NULL DEFAULT 1 CHECK (highest_stage BETWEEN 1 AND 8),
    final_outcome TEXT,
    next_action TEXT,
    follow_up_time TEXT,
    follow_up_channel TEXT,
    ai_summary JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Stage results table (one record per stage per call)
CREATE TABLE IF NOT EXISTS call_stage_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    stage_number INTEGER NOT NULL CHECK (stage_number BETWEEN 1 AND 8),
    selected_outcome TEXT,
    prospect_exact_words TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_call_stage UNIQUE (call_id, stage_number)
);

-- Transcripts table (one record per call, replaced on retry)
CREATE TABLE IF NOT EXISTS call_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    raw_transcript TEXT,
    edited_transcript TEXT,
    transcript_metadata JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT uq_call_transcript UNIQUE (call_id)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_company ON calls (company_name);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls (status);
CREATE INDEX IF NOT EXISTS idx_calls_final_outcome ON calls (final_outcome);
CREATE INDEX IF NOT EXISTS idx_calls_highest_stage ON calls (highest_stage);
CREATE INDEX IF NOT EXISTS idx_stage_results_call_id ON call_stage_results (call_id);
CREATE INDEX IF NOT EXISTS idx_stage_results_call_stage ON call_stage_results (call_id, stage_number);
CREATE INDEX IF NOT EXISTS idx_transcripts_call_id ON call_transcripts (call_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_status ON call_transcripts (status);

-- Supabase Row Level Security (RLS) Configuration
-- For service role operations or public anonymous access if enabled
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_stage_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access to calls" ON calls;
CREATE POLICY "Allow service role full access to calls" 
    ON calls FOR ALL 
    USING (true) 
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role full access to stage results" ON call_stage_results;
CREATE POLICY "Allow service role full access to stage results" 
    ON call_stage_results FOR ALL 
    USING (true) 
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role full access to transcripts" ON call_transcripts;
CREATE POLICY "Allow service role full access to transcripts" 
    ON call_transcripts FOR ALL 
    USING (true) 
    WITH CHECK (true);
