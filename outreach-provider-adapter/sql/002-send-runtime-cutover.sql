ALTER TABLE outreach_effects
  DROP CONSTRAINT IF EXISTS outreach_effects_runtime_mode_check;

ALTER TABLE outreach_effects
  ADD CONSTRAINT outreach_effects_runtime_mode_check
  CHECK (runtime_mode = ANY (ARRAY['zero-send'::text, 'canary-send'::text, 'production'::text]));

ALTER TABLE outreach_effect_events
  DROP CONSTRAINT IF EXISTS outreach_effect_events_operation_check;

ALTER TABLE outreach_effect_events
  ADD CONSTRAINT outreach_effect_events_operation_check
  CHECK (operation = ANY (ARRAY['CLAIM'::text, 'UNKNOWN'::text, 'RECONCILE'::text, 'STATUS'::text, 'RESERVE_PROVIDER_ATTEMPT'::text, 'SEND_PROVIDER'::text]));
