# Outreach v2 Gmail adapter and contained runtime

This branch contains two deliberately separate pieces:

1. the canonical Outreach v2 Gmail adapter contract; and
2. a Netlify runtime that supports zero-send diagnostics, an isolated sender-to-sender self-canary, and a production First-Touch operation that can execute only through that adapter.

Direct `SEND_PROVIDER` calls still fail closed with `CANONICAL_ADAPTER_REQUIRED` and zero provider calls. `EXECUTE_FIRST_TOUCH` delegates to `GmailOutreachV2Adapter.execute()` and is disabled unless the runtime is separately placed in `production` mode with sending enabled. The currently governed zero-send configuration therefore remains non-transmitting.

## Canonical Airtable read-only binding

The production adapter reads only exact records in canonical base `appveHEw1HrXr8nD1`. The request must contain exact Activity and Lead record IDs; Campaign `reclIlbWpaTcMrc18` and Command `recpYdDfwJjrpUwyX` are pinned both in the request and deployment configuration. The allowlisted reader issues GET requests only and re-reads current Activity, Lead, Campaign, Command and linked Suppression records immediately before the provider boundary.

Required Netlify production environment bindings are `AIRTABLE_READONLY_TOKEN`, `AIRTABLE_BASE_ID`, `OUTREACH_AIRTABLE_CAMPAIGN_RECORD_ID`, `OUTREACH_AIRTABLE_COMMAND_RECORD_ID`, and `OUTREACH_CORRELATION_DOMAIN`. The token must be limited outside the application to read-only access for the canonical base. Missing, redirected, stale, paused, suppressed, prior-contact, response-priority, payload, or relationship evidence returns HOLD before claim or provider execution.

## Canonical adapter contract

The adapter requires one durable `claimStore`, current suppression/response-priority, an exact canonical execution-authority readback, and Gmail ports. Before the provider boundary it fails closed unless the runtime payload is bound to the canonical Outreach v2 snapshots for verified recipient, sender identity, sequence instance/version, template version, final subject/body, and prior-contact CLEAR state. The exact payload snapshot is reduced to a deterministic fingerprint and must match the current Command/Release authority binding for the same EffectKey.

A caller-supplied boolean or possession of the runtime shared secret cannot mint production authority. The execution gate must provide current canonical Command and Release identities, authority version, exact EffectKey, exact payload fingerprint, verified recipient, sender identity, and a separately approved correlation domain. `.invalid` correlation domains are rejected.

Provider error handling is explicit and fail-closed: a confirmed pre-invocation failure is recorded as no-retry; an ambiguous acknowledgement becomes `UNKNOWN_HOLD`; an otherwise unclassified error after the provider boundary also becomes a separately classified `UNKNOWN_HOLD`. Reconciliation uses stored identity lookup only and contains no resend path.

## Provider-attempt reservation proof

`PostgresClaimStore.claim` uses `INSERT … ON CONFLICT DO NOTHING` against the unique EffectKey. `reserveProviderAttempt` uses one atomic conditional `UPDATE` on the same durable Effect row. The transition is permitted only when the exact `effect_key` and `claim_token` match, the Effect is `CLAIMED`, and `provider_invocation_count = 0`; it advances to `INVOCATION_STARTED`. A concurrent loser or replay receives `EXISTS_HOLD`. Confirm, `UNKNOWN_HOLD`, non-retry failure and reconciliation are fenced by the same EffectKey, claim token, deterministic payload fingerprint and provider correlation identity.

The adapter CI integration test runs two same-EffectKey reservations concurrently against PostgreSQL 16 and verifies exactly one `RESERVED`, one `EXISTS_HOLD`, one Effect row, final `provider_invocation_count = 1`, and replay HOLD. Canonical Neon application/binding and zero-send contention were proven separately and remain governed by their own Evidence and Result Check.

## Runtime CI boundary

CI now watches `netlify/functions/**`, the root runtime manifest, Netlify config and runtime regression tests. It declares `@neondatabase/serverless`, compiles `slice01.mts`, and tests that:

- production execution delegates only through the canonical adapter;
- zero-send mode rejects First-Touch before Airtable, Postgres or Gmail;
- direct `SEND_PROVIDER` cannot invoke Gmail;
- only `SELF_CANARY_SEND` reaches the contained send composition;
- self-canary destination must equal the configured sender.

## Still not production-authorized

This repair contains the direct/shared-secret production bypass. It does not activate prospect transmission.

The production-capable handler is now wired to the reviewed canonical adapter contract, but code capability is not send authority. The read-only Airtable credential, exact deployment composition, fresh exact-SHA independent PASS and Campaign/Runtime/Circuit release remain separate gates.

PR stays Draft and unmerged until independent review. No Netlify deploy, Gmail send, Airtable authority change, scheduler change or production activation is performed by this source repair.
