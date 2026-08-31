# Outreach v2 Gmail adapter skeleton

Build-only orchestration for one future provider: Gmail. Gmail is the narrowest provider because the contained historical outreach surface was Gmail; no Outlook surface exists in this repository. This package does **not** import a Gmail SDK, read credentials, expose a handler, deploy, schedule, or mutate Airtable/Netlify.

The adapter requires injected certified-slice claim, current suppression/response-priority, atomic attempt-store, and Gmail ports. It validates the canonical v2 EffectKey, requires a valid `WON` claim, rechecks safety, derives a deterministic correlation identity, reserves invocation `1` before the boundary, records confirmed outcomes, and places ambiguity in `UNKNOWN_HOLD`. Reconciliation performs identity lookup only and has no resend path.

All controls fail closed. There is no runnable production composition root; the included Gmail provider is deliberately disabled. Campaign, Runtime, Circuit, scheduler, manifest, and provider `NO-GO` state are unchanged. Enabling a production Gmail implementation, credentials/scopes/account, DNS identity, and activation controls requires Joaquin authority plus independent technical/security review.
