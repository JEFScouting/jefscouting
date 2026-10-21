# Candidate Master multirole preparation

Implements the October 16 Candidate Master decision: all selected roles retain
their own candidate-declared experience. The existing Master remains
`261480775333056`. This branch prepares the definition, provider binding,
conditional reader, canonical-field proposals and a guarded native executor
adaptation for local QA. It does **not** edit the live form or publish the
adaptation to the production receipt executor.

## What is implemented

- 29 bilingual role choices in seven families; no maximum selected-role count.
- One minimum experience answer per selected role, with a discussion option.
- Optional family detail, role-specific tasks and recency. Context stays scoped
  to the family; it is not copied to all its roles as proven experience.
- A binding verifier that resolves actual provider QIDs by explicit field name,
  type and choices. Missing, duplicated, changed or original q1–q60 IDs hold.
- A reader for the existing provider-fetched Candidate envelope. It ignores
  retained answers in unselected/closed branches, preserves the source, and
  leaves missing or unmapped information explicit.
- Review proposals using the current Candidate Profile Items table and field
  IDs. They carry candidate/source/evidence identity and stable reconciliation
  keys. They never write rows, verify competence, create Workers or update Bench.

`Secondary Role` is the existing item-type bucket used in these **proposals**.
It does not rank one role below another or assert a Best-Fit assessment. The
release reviewer must accept that crosswalk, or add an explicit appropriately
named choice in the existing table before enabling the projection. No enum or
table is changed by this branch. All proposed facts are Candidate-Entered /
Proposed — Not Promoted; Last Verified is never populated by this reader.

## Offline use

```sh
node scripts/prepare-candidate-profile.mjs --out /tmp/jef-candidate-profile
node scripts/prepare-candidate-profile.mjs --out /tmp/jef-candidate-profile --questions /private/provider-export.json
```

The first command emits the bilingual definition and logical conditions. It has
no network client and makes no provider or Airtable calls. These logical
conditions still need to be configured in Jotform; they are not a claimed
provider-native conditions export.

The second command verifies a real question export, supplied as `questions`,
`content`, or the raw QID dictionary. It writes a manifest only from returned
provider IDs. Exit code 2 means HOLD. `BOUND_FOR_QA` verifies field bindings only;
it is never a publication certificate. A claimed-envelope JSON can optionally
be read with `--envelope`; that output can contain candidate declarations and
must stay in a private task directory, not a public website or git commit.

Definition ordering puts all minimum answers before optional family detail;
each detail selector precedes the fields it opens. Configure it in the existing
Master's Positions/Experience pages, retaining shared identity, geography,
language, verification, consent and final optional CV capture. Hide empty pages
and test both visibility and required rules in the actual builder.

## Capacity and candidate burden

The [published Jotform pricing](https://www.jotform.com/pricing/), checked on
October 20, lists 250 fields per form for Bronze. The audited 54 existing
elements plus this definition's 109 give a preliminary total of 163, leaving
87 before layout elements or other changes. This supports keeping the current
plan for this slice; it does not verify this account's entitlement, usage or
the final builder count. Hidden elements still count toward form capacity.

Evaluating `profileFieldState` gives these blueprint counts, excluding shared
contact, geography, languages, consent, CV and layout. They describe the logical
definition, not observed Jotform pages or completion times.

| Selected roles and answers | Visible profile fields | Required profile answers |
| --- | ---: | ---: |
| Server, starting | 2 | 2 |
| Server, independent; details later | 3 | 2 |
| Server and Bartender independent; Front Desk starting | 6 | 4 |
| Same three roles, Service and Bar/Coffee detail open | 14 | 4 |
| Server, Banquet Server, Bartender, Barista, Line Cook, Sous Chef independent; details later | 10 | 7 |
| Same six roles, all three family detail blocks open | 28 | 7 |

These examples keep a brief required answer for every selected role. Opening
optional detail adds no required profile answer. Other requires its title in
addition to its experience answer. Live hidden/required behavior and mobile
rendering remain release checks.

## Current evidence and limits

Source baseline: `457dbaa4005169d3309d24dba9da9ebcd733d179`.
On October 16 the published native Candidate script was 39,192 characters,
SHA256 `935f63612adf9baf2ff5bec416e9154a5e8ad31c365f274b9582d097322d9bfc`.
It contains agreement extensions absent from main's 30,301-byte generated
Candidate script. Never replace it with a fresh main-generated script as a
shortcut to publish this feature. Reconcile the exact deployed/native/transport
versions and reuse the existing release work.

Scoped reads of both the existing governed admin route and the provider question
endpoint returned HTTP 401. Private conditions, notification recipients,
integration wiring, field options and entitlement counters therefore remain
unverified. No production QIDs are bound in this branch. Synthetic four-digit
QIDs exist only in tests and must not be copied into a real release manifest.

The October 17 browser attempt reached the public card form, titled
`Staff Application x JEF Scouting` with `27 Questions`, then the Jotform login
page. Those public labels are not a private configuration export or a complete
element count. Secure sign-in was interrupted; no authenticated editor state
was observed. No form edit, test submission or production mutation occurred.
Resume private inspection after secure sign-in is available; do not repeat the
same failed API credentials or infer that authentication succeeded.

Existing form-version admission and q23/q34 history are untouched. No new form
version may be published before its transport admission is compatible. PR38
handles repeated answer occurrences; PR39 handles provider timestamps. This
module does not duplicate either repair or claim they are deployed.

## Paired form and automation preparation — October 21

The form, source admission, conditional interpretation and canonical writes are
one release. Publishing a new field layout while the current automation still
expects its old structure is not an accepted intermediate state.

`candidate-profile-executor.mjs` now supplies the scoped adaptation for the
**existing** claimed Candidate writer:

- A reviewed form version **and** exact bound manifest/hash are required for the
  new profile. Existing V1 applications retain their original interpretation.
  New profile answers under an old/unexpected version hold as source evidence.
  Form-code and environment exceptions remain fatal. Other forms, including
  Representation and Client Agreement branches, pass through unchanged.
- A complete new role selection supplies the existing Target Role text summary
  without treating the first role as primary. q34's retained V1 value cannot
  become the new selection. An incomplete selection leaves that summary alone.
- Role declarations use the existing Candidate Profile Items fields. Candidate
  identity and reciprocal exact-source Evidence must already be resolved and
  read back. The module creates no person, Worker, queue, trigger or message.
- Managed Candidate-Entered / Proposed rows reconcile in place. Replay, lost
  acknowledgement and partial write recovery do not create another role row.
  Every write requires readback; failure cannot acknowledge DONE.
- Human improvements, verified/reconciled facts, conflict flags, review notes,
  duplicate rows, stale sources and competing submission streams hold only the
  affected projection. Changing an Other title requires review.
- Deselection updates the current preference flag in managed same-source
  declarations, retaining experience, original Evidence and status. Incomplete
  selections cannot withdraw other roles. Hidden branch values are filtered;
  closing optional detail retains the earlier declaration and source history.

Declarations are useful as candidate-reported facts, with their uncertainty.
They do not require a founder interview for every row, and do not establish
verified competence, exact availability, assignment readiness or commitment.
Actual matching consumption must be demonstrated before release.

### Adapt the observed native source, preserving its extensions

```sh
node scripts/prepare-candidate-profile-native.mjs \
  --out /private/candidate-native-qa \
  --native-script /private/current-observed-candidate.js \
  --expected-native-sha REVIEWED_SHA256 \
  --release /private/reviewed-candidate-release.json
```

The release JSON contains `formVersion`, `roleItemType`, `manifest` and
`bindingHash`, supplied from the private export and reviewed crosswalk. No
production manifest is supplied by this branch. `2.0` and four-digit QIDs in
tests are **synthetic QA configuration**, not a selected published version.

The offline compiler requires the exact reviewed native SHA256 and two unique
source anchors; it refuses shape/hash drift or a second application. It embeds
the new module, inserts version handling at entry and profile reconciliation
after Candidate/Evidence readback, and preserves the existing runner and all
other native branches. Node-only imports are removed from the native bundle.
It parses the complete async output and emits a **QA artifact**, always reporting
`releaseReady: false`. It makes no network calls and does not alter the checked-in
generated scripts or the current transport/normalizer.

October 21 readback of native `wflrZEVc6SWswOiVN`: deployed/valid, no differing
deployed version returned; **39,192 characters**, UTF-8 SHA256
`935f63612adf9baf2ff5bec416e9154a5e8ad31c365f274b9582d097322d9bfc`.
This matches the October 16 observed source. The live form remains ENABLED with
54 metadata elements and 230 submissions; this is not a private conditions export.

### Verification and remaining limits

The default suite includes the existing regressions and the new paired native
execution cases. A second opt-in run uses the exact observed native source plus
local copies of PR38's transport and PR39's normalizer, without merging either:

October 21 validation: **102 default tests passed; 24 opt-in native/dependency
tests passed**, including the full A→B→A case. `git diff --check` passed.
`npm run typecheck` could not run because `tsc` is not installed in this checkout.
No TypeScript transport/normalizer file is changed by this slice; the dependency
typecheck and independent review remain release requirements.

```sh
JEF_PROFILE_TEST_NATIVE_SOURCE=/private/current-observed-candidate.js \
JEF_PROFILE_TEST_TRANSPORT=/private/pr38-and-pr39/intake-transport.mts \
  node --test tests/intake/candidate-profile-executor.test.mjs
```

The dependency directory must contain PR38's `intake-transport.mts` and PR39's
`intake-normalize.mts`; the test does not download them. It proves simulated
source fetch → receipt → exact native patch → Candidate/Evidence/Profile Item
readback → completion, A→B→A as three source occurrences, consecutive replay,
and America/New_York source-time conversion. This does not certify deployment.

All provider bindings in these tests are synthetic. Current private conditions,
required rules, option translations, email verification, private editing,
notifications and integration delivery remain unverified. The Airtable writes
use the existing sole claimed writer and reread before change/create; Airtable
record APIs do not provide an atomic compare-and-swap against concurrent human
edits. Independent review and bounded live QA remain required. No founder-hour
savings are claimed from a simulation.

## Integration and release gates

1. Obtain the current private form export and rollback snapshot; configure the
   reviewed fields/conditions in an isolated authorized QA context. Keep the
   permanent form ID, historical submissions, metadata and private edit links.
2. Bind real QIDs and validate translations/options. Confirm Bronze's actual
   element limit against the complete resulting form, including retained fields.
3. Review the exact native adaptation and pending receipt/timestamp releases.
   Keep PR38/39 as dependencies; this branch does not replace or deploy them.
   Generate the native QA patch from the reviewed current source and real binding.
4. Reconcile proposals against existing Candidate Profile Items before writes;
   stable keys are not an atomic claim or proof that a row is new. Preserve
   independent human improvements, explicit preference changes, old experience,
   bans/no-shows and source evidence. Keep actual writes inside the sole executor.
5. Prove new/existing person, replay, A→B→A, partial recovery, concurrent delivery,
   private editing, EN/ES mobile behavior and canonical matching consumption.
   Security scope and any new service offering require the pertinent review.
6. Have a reviewer independent of the author assess the form and release; publish
   only the paired verified transport/native/form configuration. Preserve all
   sources and reconcile already accepted V2 entries if rollback is required.

### Coordinated cutover and rollback — proposal, not executed

1. Save private form settings, bindings, existing URLs/webhooks and the exact
   native/transport versions. Complete isolated QA and independent review.
2. Release the compatible reviewed PR38/39 transport work before admitting the
   new form version. Use only the existing Candidate dispatch pause when needed;
   allow claimed runs to finish and read back the pause/queue state.
3. Install the reviewed native adaptation while the public form is still V1;
   verify V1 compatibility first. Activate the paired fields/conditions/version
   in the same existing Master only after those checks pass. Resume controlled
   dispatch and verify one source through all existing canonical homes.
4. For a defect, pause Candidate dispatch, restore the recorded V1 presentation
   and prevent new V2 entry. Keep a compatible V2 consumer long enough to
   reconcile already accepted sources. Do not blindly restore a V1-only script
   over pending V2 receipts or delete Evidence/role declarations. Drain/review
   those sources, then restore the exact prior native version if appropriate.

The portal remains deferred. Barista Availability retirement remains a separate
existing slice requiring all 17 historical sources and a complete route census.

Tests here prove local binding/reading behavior and regression compatibility.
They do not prove Jotform rendering, webhook delivery, provider email verification,
canonical write/reconciliation, independent QA, live matching or saved founder
hours. The public form is unchanged until these release gates are completed.
