-- CallFlow Migration: Commitment Radar
-- Adds tables to track extracted commitments and potential missed opportunities

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Commitments Table
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

-- Missed Opportunities Table
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_commitments_call_id ON call_commitments (call_id);
CREATE INDEX IF NOT EXISTS idx_commitments_status ON call_commitments (status);
CREATE INDEX IF NOT EXISTS idx_missed_opps_call_id ON call_missed_opportunities (call_id);
CREATE INDEX IF NOT EXISTS idx_missed_opps_status ON call_missed_opportunities (status);

-- RLS Policies
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
