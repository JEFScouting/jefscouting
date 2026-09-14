ALTER TABLE outreach_effects
  ADD COLUMN IF NOT EXISTS provider_payload_fingerprint text,
  ADD COLUMN IF NOT EXISTS provider_correlation_id text,
  ADD COLUMN IF NOT EXISTS provider_rfc_message_id text,
  ADD COLUMN IF NOT EXISTS provider_attempt_reserved_at timestamptz;

ALTER TABLE outreach_effects
  DROP CONSTRAINT IF EXISTS outreach_effects_provider_invocation_count_check;

ALTER TABLE outreach_effects
  ADD CONSTRAINT outreach_effects_provider_invocation_count_check
  CHECK (provider_invocation_count IN (0, 1));
