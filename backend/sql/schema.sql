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

-- Commitment Radar: Extracted commitments
CREATE TABLE IF NOT EXISTS call_commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    responsible_party TEXT NOT NULL DEFAULT 'unknown' CHECK (responsible_party IN ('caller', 'prospect', 'another_person', 'unknown')),
    commitment_status TEXT NOT NULL DEFAULT 'uncertain' CHECK (commitment_status IN ('explicitly_agreed', 'promised', 'requested', 'suggested', 'uncertain')),
    due_at TIMESTAMPTZ,
    relative_due TEXT,
    channel TEXT NOT NULL DEFAULT 'unknown' CHECK (channel IN ('phone', 'email', 'WhatsApp', 'Google Meet', 'unknown')),
    evidence_quote TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    needs_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Commitment Radar: Missed opportunities
CREATE TABLE IF NOT EXISTS call_missed_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('need_not_explored', 'objection_unresolved', 'question_unanswered', 'referral_untracked', 'meeting_unconfirmed', 'no_next_step')),
    severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
    description TEXT NOT NULL,
    evidence_quote TEXT NOT NULL,
    why_it_matters TEXT NOT NULL,
    suggested_action TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    needs_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_commitments_call_id ON call_commitments (call_id);
CREATE INDEX IF NOT EXISTS idx_commitments_status ON call_commitments (status);
CREATE INDEX IF NOT EXISTS idx_missed_opps_call_id ON call_missed_opportunities (call_id);
CREATE INDEX IF NOT EXISTS idx_missed_opps_status ON call_missed_opportunities (status);

ALTER TABLE call_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_missed_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access to commitments" ON call_commitments;
CREATE POLICY "Allow service role full access to commitments"
    ON call_commitments FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role full access to missed opportunities" ON call_missed_opportunities;
CREATE POLICY "Allow service role full access to missed opportunities"
    ON call_missed_opportunities FOR ALL
    USING (true)
    WITH CHECK (true);

-- Conversation Gap Detector: call_conversation_gaps table
CREATE TABLE IF NOT EXISTS call_conversation_gaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('missed_discovery', 'unresolved_question', 'unconfirmed_agreement', 'unaddressed_objection', 'unexplored_referral')),
    severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence_quote TEXT NOT NULL,
    context_quote TEXT,
    why_it_matters TEXT NOT NULL,
    suggested_action TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    commitment_id UUID REFERENCES call_commitments(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_gaps_call_id ON call_conversation_gaps (call_id);
CREATE INDEX IF NOT EXISTS idx_gaps_status ON call_conversation_gaps (status);
CREATE INDEX IF NOT EXISTS idx_gaps_type ON call_conversation_gaps (type);

ALTER TABLE call_conversation_gaps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access to conversation gaps" ON call_conversation_gaps;
CREATE POLICY "Allow service role full access to conversation gaps"
    ON call_conversation_gaps FOR ALL
    USING (true)
    WITH CHECK (true);

