-- Migration: Non-linear stages, stage status, and extended call closure fields
-- Distinguishes skipped/not applicable stages from completed stages.
-- Adds callback, referral, objection, and prospect statement recording.

-- 1. Add status to call_stage_results if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'call_stage_results' AND column_name = 'status'
    ) THEN
        ALTER TABLE call_stage_results ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
    END IF;
END $$;

-- 2. Add extended outcome tracking to calls table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'calls' AND column_name = 'referral_name'
    ) THEN
        ALTER TABLE calls ADD COLUMN referral_name TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'calls' AND column_name = 'referral_contact'
    ) THEN
        ALTER TABLE calls ADD COLUMN referral_contact TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'calls' AND column_name = 'objection'
    ) THEN
        ALTER TABLE calls ADD COLUMN objection TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'calls' AND column_name = 'prospect_statement'
    ) THEN
        ALTER TABLE calls ADD COLUMN prospect_statement TEXT;
    END IF;
END $$;
