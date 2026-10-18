-- CallFlow Migration: Conversation Gap Detector
-- Adds table to track potential missed discovery opportunities, unresolved questions,
-- unconfirmed agreements, unaddressed objections, and unexplored referrals.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Conversation Gaps Table
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

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_gaps_call_id ON call_conversation_gaps (call_id);
CREATE INDEX IF NOT EXISTS idx_gaps_status ON call_conversation_gaps (status);
CREATE INDEX IF NOT EXISTS idx_gaps_type ON call_conversation_gaps (type);

-- RLS Policies
ALTER TABLE call_conversation_gaps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow service role full access to conversation gaps" ON call_conversation_gaps;
CREATE POLICY "Allow service role full access to conversation gaps"
    ON call_conversation_gaps FOR ALL
    USING (true)
    WITH CHECK (true);
