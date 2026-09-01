# Outreach v2 Gmail adapter skeleton

Build-only orchestration for one future provider: Gmail. Gmail remains the narrowest provider candidate for this isolated skeleton. This package does **not** import a Gmail SDK, read credentials, expose a production handler, deploy, schedule, or mutate Airtable/Netlify.

The adapter requires one durable `claimStore`, current suppression/response-priority, an exact canonical execution-authority readback, and Gmail ports. Before the provider boundary it fails closed unless the runtime payload is bound to the canonical Outreach v2 snapshots for verified recipient, sender identity, sequence instance/version, template version, final subject/body, and prior-contact CLEAR state. The exact payload snapshot is reduced to a deterministic fingerprint and must match the current Command/Release authority binding for the same EffectKey.

A caller-supplied boolean cannot mint production authority. The execution gate must provide current canonical Command and Release identities, authority version, exact EffectKey, exact payload fingerprint, verified recipient, sender identity, and a separately approved correlation domain. `.invalid` correlation domains are rejected.

Provider error handling is explicit and fail-closed: a confirmed pre-invocation failure is recorded as no-retry; an ambiguous acknowledgement becomes `UNKNOWN_HOLD`; an otherwise unclassified error after the provider boundary also becomes a separately classified `UNKNOWN_HOLD`. Reconciliation uses stored identity lookup only and contains no resend path.

## Provider-attempt reservation proof

`PostgresClaimStore.reserveProviderAttempt` uses one atomic conditional `UPDATE` on the same durable Effect row. The transition is permitted only when the exact `effect_key` and `claim_token` match, the Effect is `CLAIMED`, and `provider_invocation_count = 0`. The winning transaction sets the count to exactly `1` and stores the payload/correlation reservation evidence. A concurrent loser or replay receives `EXISTS_HOLD` and cannot create a second reservation.

The CI integration test runs two same-EffectKey reservations concurrently against a real PostgreSQL 16 service and verifies exactly one `RESERVED`, one `EXISTS_HOLD`, one Effect row, final `provider_invocation_count = 1`, and replay HOLD. This proves the transactional Postgres implementation semantics; it does **not** by itself prove that the migration has been applied and the implementation bound to JEF's canonical Neon runtime.

## Still not production-certified

Canonical Neon application/binding remains a separate gate: apply the provider-attempt reservation migration to the existing durable Outreach store, bind the current zero-send runtime to this implementation, run the same-EffectKey concurrent zero-send UAT there, and independently verify the result. No production provider invocation is required for that proof.

Production also requires separate certification of the real Gmail provider implementation, approved correlation domain/lookup behavior, credentials/scopes/account binding, current Command/Release authority, runtime/security controls, deployment composition, and all existing Outreach Campaign/Runtime/Circuit release gates.

There is no runnable production Gmail composition root; the included Gmail provider remains deliberately disabled. Campaign, Runtime, Circuit, scheduler, manifest, and provider `NO-GO` state remain unchanged. No production send authority is granted by this branch or PR.
