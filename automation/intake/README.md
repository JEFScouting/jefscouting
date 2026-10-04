# Existing JEF intake repair — release evidence and runbook

Status: IMPLEMENTED IN CODE; LIVE END-TO-END CERTIFICATION PENDING. This is not a closure report. Local test success is not evidence that either live Jotform integration delivered a canonical record.

Checkpoint 2026-10-04: both existing Airtable drafts were saved through the native script editor and independently read back byte-for-byte against PR #34 (`256275257a14cf6e4448ab25247d174a51602155`). Candidate is valid and OFF; Client is valid with unpublished changes, while its published graph still contains the old two find-record actions and conditional group. Candidate's private Netlify destination is now present and exactly matches the existing automation webhook. No native automation has been activated by this repair, and no QA business records have been written.

The provider report generated at 2026-10-01T13:31:51Z additionally confirms Candidate has no other configured integrations and Client has only the existing Netlify webhook integration. The temporary provider-check build registration is removed in this release; its source remains inactive historical diagnostic code. Its encrypted artifact must be absent from the current production deploy after release.

The existing receipt queue now supports `JEF_CANDIDATE_INTAKE_DISPATCH_PAUSED` and `JEF_CLIENT_INTAKE_DISPATCH_PAUSED`. A value of `true` durably accepts verified V2 submissions without invoking either native action graph, reports `queued_pending_activation`, and permits an already claimed run to finish. This is a cutover control in the existing adapter, not another intake path. Both lanes must have pause and V2 settings independently read back before requesting native activation. The Netlify connector can report successful creation even when the provider rejects a scope selection; never rely on that acknowledgement without readback. Supported all-scopes variables still encounter the adapter's production-only guard.

Checkpoint 2026-10-01: PR #31 is merged as `f3561f71530336a7376fb3a3da8ade9905898ae3`, production deploy `6ab9c5ecc97ade0008ea2884` is ready, and both existing Airtable drafts contain the exact generated scripts with dynamic receiptId/token inputs and captured trigger schemas. Candidate is still OFF; Client's original graph is still published. Both V2 flags remain disabled. Connected Jotform reads confirm both forms are enabled (225 Candidate / 1 Client submissions) and provide real submission field IDs/answers. Browser Google SSO failure is not a provider/API outage.

A temporary `provider-check` build hook made only authenticated GET requests using the credentials already scoped to this Netlify project. It reported webhook classifications/fingerprints, question IDs/types, recent submission IDs/times, and redacted adapter status in the existing deploy summary. It created no route, credential, submission or record; no source answers, private webhook URLs, or credentials appeared in logs. It was limited to this production project and expired 2026-10-03 UTC. Its `netlify.toml` registration is now removed.

Because the Netlify connector does not return plugin report details, that same sanitized report also has an RSA-OAEP-SHA256 + AES-256-GCM encrypted build artifact. Only the public encryption key is committed; the private key stays outside this repository. Remove the temporary build hook and artifact after readback. This follows the prior bounded encrypted provider-readback pattern without reviving its retired public runtime endpoint.

Authenticated provider readback at 2026-10-01T13:26:52Z found zero Candidate webhooks and one Client webhook. The Client destination fingerprint exactly matches `https://jefscouting.netlify.app/api/client-jotform-webhook`, the existing project hostname and route; retain it. Authenticated status GETs on both existing adapters returned 200, idle, with zero V2 receipts. This proves provider/admin API access works without browser SSO; it does not prove a delivered intake. The latest Candidate source ID was `6664250389491600909` (2026-09-28). Native-script release additionally corrects a real-source dry-run finding: equivalent historical phone formatting must normalize without a false canonical-data conflict.

## Existing assets and observed defects

The canonical base is `appveHEw1HrXr8nD1`. This repair continues `JEFScouting/jefscouting`, the existing `candidate-jotform-webhook` branch, the existing Netlify project, the two existing function routes, the two existing native Airtable automations, and the original forms. No base, table, form or alternate CRM is created.

| Lane | Form | Existing endpoint | Existing native automation | Canonical destination |
| --- | --- | --- | --- | --- |
| Candidate | 261480775333056 | https://jefscouting.com/api/candidate-jotform-webhook | wflrZEVc6SWswOiVN | Candidates `tblwNK4Eh45g211IO`, linked Evidence / Files `tblmeZC1GiM0R6VhK` |
| Client | 262081932367056 | https://jefscouting.com/api/client-jotform-webhook | wflwGGOx0v1PEr6m8 | Client Intake `tbl9Phdpg1UUZ6Lt6`, Clients `tblQFZrTdguo4tIHD`, existing corroborated Leads `tblaCk5tyADLKIuwv`, linked Evidence / Files |

At preflight, production Netlify was commit `738ee9f65ed573356ed51fddff89a1fa758b239f`. Candidate's Airtable automation was an OFF draft with only a placeholder find-record action and no writes; its Netlify destination variable was missing. Client's automation was ON but wrote only partial intake/evidence, did not reconcile/link the canonical account, and had an impossible recovery condition requiring the same result to be both empty and not empty. Prior manual records already existed. The historical one-off remediation branch is not the production architecture.

The legacy Client implementation trusted caller-supplied answers and treated webhook acceptance as success. This repair fetches the actual submission from Jotform with the existing server-side API key; receipt completion is recorded only after native Airtable readback.

## Code behavior

1. Validate form and immutable submission ID, then fetch the authoritative provider submission. Discard caller-supplied answer data.
2. Preserve every provided answer, including explicit negatives, original local timestamps and upload references. Normalize contacts and supported fields; retain unknown fields in source Evidence rather than infer values.
3. Persist a versioned technical receipt in the same Netlify project's private Blobs storage before dispatch. This store is delivery state, not canonical business Reality.
4. Serialize native Airtable writes per lane. A simultaneous second submission is durable and completion dispatches it automatically. A claimed writer is never replaced on a timer.
5. The existing native automation claims its receipt with a one-use random token, reconciles the canonical records, verifies fields/relationships, and acknowledges a terminal result.
6. Return 202 while Airtable is pending. A 200 webhook response alone does not mean successful reconciliation.

Same submission and unchanged source version reuses the receipt. A changed submission produces a new source snapshot but reuses the canonical entity. A separate submission for an existing person retains the original master submission ID and adds its evidence. Canonical source IDs and multi-signal identity checks also protect replays if transport state is lost. Concurrent non-adapter writers remain outside the adapter's lock; ambiguous pre-existing duplicates stop reconciliation.

Only blanks, identical values and fields still equal to this adapter's prior recorded value can be updated automatically. Human-enriched conflicting values survive and produce a visible exception. Clients' established main/billing contact is preserved. A request worksite is not copied into account headquarters.

Candidate matching uses source identifiers, normalized contacts, name corroboration, canonical redirects, environment and prior reconciliation disposition. Conflicting email/phone targets, name-only possible duplicates, missing routes or held identity become exceptions.

Client matching uses request source identifiers, existing account relationships, corroborated hidden references, exact business name and contact evidence. A hidden Lead ID alone is insufficient; the existing Lead must independently match business and contact. Its existing Client relationship is reused, not duplicated. A new account is `Lead`, never `Active`.

No work authorization verification, reliability, readiness, bench/shortlist promotion, Worker activation, assignment commitment, staffing authorization, performance or communications are inferred. Free-text experience and original uploads remain source facts; they are not converted into curated Professional Experience or JEF CV artifacts by interpretation. Private profile-edit links are not fabricated or exposed.

## Mappings

| Source | Canonical field / handling |
| --- | --- |
| Candidate q3 / q4 / q5 | Candidate / Phone / Email |
| Candidate q8 | Location (home city/state/country) |
| Candidate q11 | Preferred Work Areas, separate from home |
| Candidate q34 / q36 | Target Role / Availability |
| Candidate q14 | English Level; Fluent / Native -> Fluent; Conversational retained literally |
| Candidate q27 | Original file references in Evidence; Received Original only for a new record with files |
| Candidate all other answered qids | Complete immutable source snapshot in Evidence; no subjective promotion |
| Client q2 / q3 / q5 / q6 | Client Name / Contact Name / Email / Phone |
| Client q8 / q9 / q15 / q16 | Requested Location / Service Needed / Urgency / Commercial Requirement |
| Client q27 / q28 | Verified existing Lead / Client references, or exception |
| Client q10–14 / q17–23 / other answered qids | Exact operational/request facts in Intake Notes and complete Evidence snapshot |
| Client q20 | Original uploaded-file references in Evidence |

On 2026-09-27, additive schema repairs were saved and independently read back: Candidate English Level gained the live form's `Conversational`; Client Intake Service Needed gained `Temporary Staffing & Payroll Support`, `Trial-to-Hire`, `Direct Hire Recruiting`, `Not Sure`. Original choices and all record values were retained. These are literal existing form answers, not invented classifications. `Not Sure` is retained and flagged as unresolved intent. No form questions were added.

## Installation and coordinated cutover

Do not enable V2 dispatch while either automation still has its old action graph. The old implementation remains the sole multipart handler while its lane's V2 flag is absent/false. To cross the human activation boundary safely, enable V2 only with its dispatch pause already set and the pause-capable adapter deployed. Preview deployments cannot write production Reality.

- Required existing secret: `JOTFORM_API_KEY`. Existing operational inspection uses `JOTFORM_ADMIN_SECRET`; neither is exposed in this repo.
- Configure `AIRTABLE_CANDIDATE_JOTFORM_WEBHOOK_URL` with the webhook of the existing Candidate automation. Retain `AIRTABLE_CLIENT_JOTFORM_WEBHOOK_URL` for the existing Client automation. Treat complete webhook URLs as private configuration.
- Generate native script files with `npm run build:intake`. In each existing automation draft, replace obsolete actions with one Run a script action using `generated/candidate.js` or `generated/client.js`.
- Map script inputs `receiptId` and `token` from the webhook body's fields. Capture the V2 trigger sample while Candidate is OFF. Client needs a controlled cutover: posting a sample to an ON automation executes its current graph.
- Airtable's automation connector explicitly reserves activation/applying the draft to human review in the UI. Do not bypass that gate. Prepare the full draft and test inputs first.
- Set and verify each lane's `JEF_<LANE>_INTAKE_DISPATCH_PAUSED=true` before enabling `JEF_<LANE>_INTAKE_V2_ENABLED=true`, then deploy the same verified code with those settings. While paused, valid submissions remain in the existing durable queue. The native gate is then safe: human turns Candidate ON and applies Client Update. Read back both published scripts before setting each pause to `false` and deploying. Inspect attention items and issue the existing authenticated retry on the oldest queued receipt; subsequent completion drains the queue automatically. Reconcile any source-versus-receipt gaps from the bounded cutover window.
- Retain the single existing Client Jotform webhook. Candidate still needs its missing webhook registered to the existing Candidate adapter, after configuration is verified. Use authenticated provider API operations where available; browser SSO is not a dependency for the inspection already completed. Recheck integrations before introducing the missing connection. Do not create another form or another automation.
- Confirm the provider timestamp basis using a real canary before certification. The current code retains timezone-less provider timestamps verbatim and does not invent a UTC offset; Client Source Event Timestamp is only populated when the provider has an explicit offset. This is a remaining release gap, not an Owner transcription task.

## Failure visibility and recovery

Authenticated GET on the same lane endpoint returns V2 enabled/pause state, active/last receipt, counts, up to 50 attention items, terminal record IDs and error codes. Optional `receiptId` query selects one technical receipt. Use `Authorization: Bearer <existing JOTFORM_ADMIN_SECRET>`. Responses contain no answers or tokens.

For a queued, failed or unclaimed dispatching receipt, authenticated JSON POST `{ "action": "retry", "receiptId": "<receipt path from status>" }` resumes the same receipt. Retry cannot replace a claimed writer. A retried dispatch shares the same token; only one native run can claim it. Native automation failures, sanitized Netlify logs and Evidence `Provenance Disposition = Needs Review` are the existing operational surfaces.

If a script is still claimed, inspect its native run and read back affected records. Never delete the lane lock or blindly replay while a writer may still run. If completion acknowledgement was lost, repeat the original completion from that native run after verifying its outcome. This is an infrastructure exception, not ordinary intake work.

Provider events that never reach Netlify still require visibility in Jotform's integration delivery history and source-versus-receipt checks. Confirm the existing failure notification/retry mechanism after sign-in before closing this task. No unverified alerting claim is made here.

Rollback requires coordinating both the native draft and lane flag; turning V2 off alone is not sufficient after its native script replaced the old graph. Use the captured preflight configuration and prior main commit. Preserve source snapshots and receipt state; do not delete business records as rollback.

## Proof obtained and still required

Local verification: 55 tests passing on Node 24, strict TypeScript check passing. Tests use synthetic fixtures and a simulated provider/store/native Airtable API. Coverage includes new and existing entities, historical manual records, empty optionals, explicit negatives, identity collisions, provider/form mismatch, malformed requests, replay, concurrent delivery/claim, partial write failure, human data protection, Lead corroboration, service option drift, source versions, automatic second-submission dispatch, equivalent historical phone formatting, and both lanes' durable cutover pause/retry behavior.

**Live canaries performed: none. Live end-to-end certification: NOT PROVEN.** No QA business records have been created by this repair as of this checkpoint.

For both live forms, record real source submission IDs, receipt IDs, native run IDs, canonical record IDs and readback evidence for: new entity; existing entity update; replay; missing optional values; ambiguous identity; malformed input; and failure observability. Use `[JEF INTAKE QA]` names and isolated non-production contact routes. The formulas then classify records as QA; stable identifiers start TEST where applicable. Preserve canary evidence and mark all test records. No outreach or downstream operational action is part of QA.

A submission created through the Jotform API does not by itself prove the form's webhook fires. The actual public form path must be exercised, including the Candidate form's existing email verification and upload requirements, without disabling them.

## Machinery to retire after proven cutover

Retire the Candidate placeholder find-record action and Client's old partial-create/recovery action graph within their existing automations. Remove `_shared/legacy-*.mts` only after both paths are certified and rollback retention is complete. Do not revive retired Update Inbox, Modules Registry or Command Ledger architecture. Historical remediation scripts and manual recovery exports remain evidence, not competing production writers.
