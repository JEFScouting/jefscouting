# Candidate Master multirole preparation

Implements the October 16 Candidate Master decision: all selected roles retain
their own candidate-declared experience. The existing Master remains
`261480775333056`. This branch prepares the definition, provider binding,
conditional reader and canonical-field proposals. It does **not** edit the live
form or wire a new production writer into the receipt executor.

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

## Integration and release gates

1. Obtain the current private form export and rollback snapshot; configure the
   reviewed fields/conditions in an isolated authorized QA context. Keep the
   permanent form ID, historical submissions, metadata and private edit links.
2. Bind real QIDs and validate translations/options. Confirm Bronze's actual
   element limit against the complete resulting form, including retained fields.
3. Reconcile the native script drift and pending receipt/timestamp releases.
   Connect `readCandidateProfile` only inside the existing claimed Candidate
   executor, after authoritative source fetch and successful identity resolution.
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

Tests here prove local binding/reading behavior and regression compatibility.
They do not prove Jotform rendering, webhook delivery, provider email verification,
canonical write/reconciliation, independent QA, live matching or saved founder
hours. The public form is unchanged until these release gates are completed.
