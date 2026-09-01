# Outreach v2 Gmail adapter skeleton

Build-only orchestration for one future provider: Gmail. Gmail remains the narrowest provider candidate for this isolated skeleton. This package does **not** import a Gmail SDK, read credentials, expose a handler, deploy, schedule, or mutate Airtable/Netlify.

The adapter now requires injected certified-slice claim, current suppression/response-priority, an exact canonical execution-authority readback, atomic attempt-store, and Gmail ports. Before the provider boundary it fails closed unless the runtime payload is bound to the canonical Outreach v2 snapshots for verified recipient, sender identity, sequence instance/version, template version, final subject/body, and prior-contact CLEAR state. The exact payload snapshot is reduced to a deterministic fingerprint and must match the current Command/Release authority binding for the same EffectKey.

A caller-supplied boolean cannot mint production authority. The execution gate must provide current canonical Command and Release identities, authority version, exact EffectKey, exact payload fingerprint, verified recipient, sender identity, and a separately approved correlation domain. The old hard-coded `@outreach.invalid` identity is rejected by the adapter.

Provider error handling is explicit and fail-closed: a confirmed pre-invocation failure is recorded as no-retry; an ambiguous acknowledgement becomes `UNKNOWN_HOLD`; an otherwise unclassified error after the provider boundary also becomes a separately classified `UNKNOWN_HOLD`. Reconciliation uses stored identity lookup only and contains no resend path.

The mock-only regression suite covers canonical authority/payload binding, recipient/sender/content tamper blocking, deterministic correlation identity, claim/suppression gates, ambiguous acknowledgement, pre-invocation failure, unclassified post-boundary failure, replay prevention, and lookup-only reconciliation.

## Still not production-certified

This hardening does **not** activate production Gmail and does not close all independent-review findings. Before production composition, the real transactional attempt-store must still prove one reservation / one provider invocation under concurrent contention. Production must also supply and independently certify the real Gmail provider implementation, approved correlation domain/lookup behavior, credentials/scopes/account binding, current Command/Release authority, runtime/security controls, deployment composition, and all existing Outreach campaign/runtime/circuit release gates.

There is no runnable production composition root; the included Gmail provider remains deliberately disabled. Campaign, Runtime, Circuit, scheduler, manifest, and provider `NO-GO` state remain unchanged. No production send authority is granted by this branch or PR.
