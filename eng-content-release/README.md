# ENG-CONTENT-RELEASE dual-read adapter

This directory materializes only the diagnostic dual-read boundary of the
existing canonical `ENG-CONTENT-RELEASE` contract.

It is not a second release engine. It has no HTTP endpoint, provider client,
Planable dependency, scheduler, persistence layer, deployment configuration,
or production authority. The adapter accepts an already-read Content OS
record, evaluates the legacy and reconstructed decision surfaces, and returns
an auditable comparison with an explicit zero-effect census.

Production cutover, provider invocation, publication, and retirement of legacy
controls remain outside this artifact and require separate authorization.

Repository fixtures are intentionally de-identified. Exact canonical Airtable
record identities and readback evidence remain only in the existing governed
Evidence record.
