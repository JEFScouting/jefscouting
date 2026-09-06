# Outreach v2 Gmail adapter and contained runtime

This branch contains two deliberately separate pieces:

1. the canonical Outreach v2 Gmail adapter contract; and
2. a Netlify runtime that supports zero-send diagnostics and an isolated sender-to-sender self-canary.

The Netlify handler contains Gmail OAuth, profile, lookup, MIME and send primitives, but it does **not** expose a production prospect-send path. Runtime mode `production` is rejected. Direct `SEND_PROVIDER` calls fail closed with `CANONICAL_ADAPTER_REQUIRED` and zero provider calls. The only transport-capable handler operation is `SELF_CANARY_SEND`, which requires `canary-send` mode, send enablement and exact sender-to-sender destination equality.

## Canonical adapter contract

The adapter requires one durable `claimStore`, current suppression/response-priority, an exact canonical execution-authority readback, and Gmail ports. Before the provider boundary it fails closed unless the runtime payload is bound to the canonical Outreach v2 snapshots for verified recipient, sender identity, sequence instance/version, template version, final subject/body, and prior-contact CLEAR state. The exact payload snapshot is reduced to a deterministic fingerprint and must match the current Command/Release authority binding for the same EffectKey.

A caller-supplied boolean or possession of the runtime shared secret cannot mint production authority. The execution gate must provide current canonical Command and Release identities, authority version, exact EffectKey, exact payload fingerprint, verified recipient, sender identity, and a separately approved correlation domain. `.invalid` correlation domains are rejected.

Provider error handling is explicit and fail-closed: a confirmed pre-invocation failure is recorded as no-retry; an ambiguous acknowledgement becomes `UNKNOWN_HOLD`; an otherwise unclassified error after the provider boundary also becomes a separately classified `UNKNOWN_HOLD`. Reconciliation uses stored identity lookup only and contains no resend path.

## Provider-attempt reservation proof

`PostgresClaimStore.reserveProviderAttempt` uses one atomic conditional `UPDATE` on the same durable Effect row. The transition is permitted only when the exact `effect_key` and `claim_token` match, the Effect is `CLAIMED`, and `provider_invocation_count = 0`. The winning transaction sets the count to exactly `1` and stores the payload/correlation reservation evidence. A concurrent loser or replay receives `EXISTS_HOLD` and cannot create a second reservation.

The adapter CI integration test runs two same-EffectKey reservations concurrently against PostgreSQL 16 and verifies exactly one `RESERVED`, one `EXISTS_HOLD`, one Effect row, final `provider_invocation_count = 1`, and replay HOLD. Canonical Neon application/binding and zero-send contention were proven separately and remain governed by their own Evidence and Result Check.

## Runtime CI boundary

CI now watches `netlify/functions/**`, the root runtime manifest, Netlify config and runtime regression tests. It declares `@neondatabase/serverless`, compiles `slice01.mts`, and tests that:

- `production` runtime mode is unavailable;
- direct `SEND_PROVIDER` cannot invoke Gmail;
- only `SELF_CANARY_SEND` reaches the contained send composition;
- self-canary destination must equal the configured sender.

## Still not production-authorized

This repair contains the direct/shared-secret production bypass. It does not activate prospect transmission.

A later production-capable handler must delegate through the reviewed canonical adapter contract (or enforce the identical current Command/Release, frozen payload/recipient/sender, suppression and response-priority boundary) and receive a fresh exact-SHA independent PASS. Gmail account/scope binding, deploy composition, self-canary evidence and Campaign/Runtime/Circuit release remain separate gates.

PR stays Draft and unmerged until independent review. No Netlify deploy, Gmail send, Airtable authority change, scheduler change or production activation is performed by this source repair.
