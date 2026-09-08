import assert from "node:assert/strict";
import test from "node:test";

const { default: handler } = await import(
  new URL("../netlify/functions/next-slack-r1-read.mts", import.meta.url)
);

const exactBindingId =
  "CB-NEXT-SLACK-R1-A0BVA18EG4D-T0BC95ACRU5-PROD-A0-C0BCCH6PYAE";
const exactSiteId = "2d5cef57-c959-403d-b518-ca5c40ec0462";
const exactScopes = "channels:history,channels:read";
const exactCommandId = "CMD-NEXT-SLACK-R1-FIXTURE";
const exactReleaseId = "REL-NEXT-SLACK-R1-FIXTURE";
const exactApprovalId = "APR-NEXT-SLACK-R1-FIXTURE";
const exactIdentity = {
  ok: true,
  team_id: "T0BC95ACRU5",
  user_id: "U0BV7SX3R1U",
  bot_id: "B0BV5DPEQDZ",
};

let traceState;

function canonicalCommand(overrides = {}) {
  return {
    id: "rec-command-fixture",
    fields: {
      "Command ID": exactCommandId,
      "Tenant ID": "TEN-JEF-PROD",
      "Command Type": "Release",
      Status: "Approved",
      Authority: "A0 — Observe/Read",
      "Approval ID": exactApprovalId,
      ...overrides,
    },
  };
}

function canonicalRelease(overrides = {}) {
  return {
    id: "rec-release-fixture",
    fields: {
      "Release ID": exactReleaseId,
      "Tenant ID": "TEN-JEF-PROD",
      "Release Type": "Configuration Release",
      Status: "Approved",
      "Command ID": exactCommandId,
      "Approval ID": exactApprovalId,
      "Target System": "Slack",
      "Target Resource": `binding:${exactBindingId}|channel:C0BCCH6PYAE`,
      "Allowed Fields / Action":
        "A0 read-only; auth.test + conversations.history; channel C0BCCH6PYAE; zero writes",
      "Precondition Check IDs": "RC-NEXT-SLACK-R1-FIXTURE PASS",
      "Idempotency Key": "NEXT-SLACK-R1|FIXTURE|RELEASE",
      "Rollback Reference": "Disable binding/canary; preserve evidence; no provider write exists.",
      "Authorized At": "2026-09-08T21:00:00.000Z",
      ...overrides,
    },
  };
}

function canonicalApproval(overrides = {}) {
  return {
    id: "rec-approval-fixture",
    fields: {
      "Approval ID": exactApprovalId,
      "Tenant ID": "TEN-JEF-PROD",
      Status: "Approved",
      "Separation of Duties Check": "Passed",
      ...overrides,
    },
  };
}

function configureTraceMock(overrides = {}) {
  traceState = {
    calls: [],
    replayRuntimeRun: false,
    commandRecords: [canonicalCommand()],
    releaseRecords: [canonicalRelease()],
    approvalRecords: [canonicalApproval()],
    ...overrides,
  };

  globalThis.__NEXT_SLACK_R1_TRACE_FETCH = async (url, init = {}) => {
    const stringUrl = String(url);
    const method = init.method ?? "GET";
    const parsedBody = init.body ? JSON.parse(String(init.body)) : null;
    traceState.calls.push({ url: stringUrl, method, body: parsedBody });

    assert.equal(init.headers.authorization, "Bearer fixture-airtable-token");

    if (method === "GET" && stringUrl.includes("appBUnJ5tQSKXAoA2/tbl6qsFiNpFKjDoYx")) {
      return Response.json({ records: traceState.commandRecords });
    }
    if (method === "GET" && stringUrl.includes("appBUnJ5tQSKXAoA2/tbleUiVeDG8hNimPK")) {
      return Response.json({ records: traceState.releaseRecords });
    }
    if (method === "GET" && stringUrl.includes("appBUnJ5tQSKXAoA2/tbldSBuGWIdGtMYtd")) {
      return Response.json({ records: traceState.approvalRecords });
    }
    if (method === "GET" && stringUrl.includes("appBUnJ5tQSKXAoA2/tblNe1vDlPjcSDEDC")) {
      return Response.json({
        records: traceState.replayRuntimeRun
          ? [{ id: "rec-existing-runtime", fields: { "Run ID": "RUN-FIXTURE" } }]
          : [],
      });
    }
    if (method === "POST" && stringUrl.endsWith("appBUnJ5tQSKXAoA2/tblNe1vDlPjcSDEDC")) {
      return Response.json({ records: [{ id: "rec-runtime-fixture" }] });
    }
    if (method === "PATCH" && stringUrl.endsWith("appBUnJ5tQSKXAoA2/tblNe1vDlPjcSDEDC")) {
      return Response.json({ records: [{ id: "rec-runtime-fixture" }] });
    }
    if (method === "POST" && stringUrl.endsWith("appBUnJ5tQSKXAoA2/tblcDIssO3HoqsxuZ")) {
      return Response.json({ records: [{ id: "rec-event-fixture" }] });
    }
    if (method === "POST" && stringUrl.endsWith("appveHEw1HrXr8nD1/tblmeZC1GiM0R6VhK")) {
      return Response.json({ records: [{ id: "rec-evidence-fixture" }] });
    }

    return Response.json({ error: { type: "UNEXPECTED_TRACE_REQUEST" } }, { status: 500 });
  };
}

function configureEnv(overrides = {}, traceOverrides = {}) {
  configureTraceMock(traceOverrides);
  const values = new Map(
    Object.entries({
      NEXT_SLACK_R1_RUNTIME_SECRET: "fixture-runtime-secret",
      NEXT_SLACK_R1_BOT_TOKEN: "fixture-bot-token",
      NEXT_SLACK_R1_AIRTABLE_TOKEN: "fixture-airtable-token",
      NEXT_SLACK_R1_ACTIVE_BINDING_ID: exactBindingId,
      NEXT_SLACK_R1_BINDING_ACTIVE: "false",
      NEXT_SLACK_R1_CANARY_ENABLED: "false",
      ...overrides,
    }),
  );
  globalThis.Netlify = { env: { get: (key) => values.get(key) } };
}

function request(body = {}, options = {}) {
  const envelope = {
    operation: "PRECHECK",
    bindingId: exactBindingId,
    environment: "Production / Live",
    authority: "A0",
    tokenClass: "BOT",
    resourceId: "C0BCCH6PYAE",
    runtimeRunId: "RUN-FIXTURE",
    envelopeId: "ENV-NEXT-SLACK-R1-FIXTURE",
    effectKey: "NEXT-SLACK-R1|FIXTURE",
    commandId: exactCommandId,
    releaseId: exactReleaseId,
    ...body,
  };
  return new Request("https://fixture.invalid/api/next-slack-r1-read", {
    method: options.method ?? "POST",
    headers: {
      authorization: `Bearer ${options.secret ?? "fixture-runtime-secret"}`,
      "content-type": "application/json",
    },
    body: (options.method ?? "POST") === "POST" ? JSON.stringify(envelope) : undefined,
  });
}

function response(payload, scopes = exactScopes, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...(scopes === null ? {} : { "x-oauth-scopes": scopes }),
    },
  });
}

function productionContext(overrides = {}) {
  return {
    deploy: { context: "production", id: "fixture-deploy", published: true },
    site: { id: exactSiteId, name: "jef-next-slack-r1", url: "https://fixture.invalid" },
    ...overrides,
  };
}

async function bodyOf(result) {
  return await result.json();
}

function noProvider() {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("unexpected provider call");
  };
  return () => calls;
}

test("missing provider credential holds before authority or provider access", async () => {
  configureEnv({ NEXT_SLACK_R1_BOT_TOKEN: "" });
  const calls = noProvider();
  const result = await handler(request(), productionContext());
  assert.equal(result.status, 503);
  assert.equal((await bodyOf(result)).state, "HOLD");
  assert.equal(calls(), 0);
  assert.equal(traceState.calls.length, 0);
});

test("wrong runtime secret rejects before authority or provider access", async () => {
  configureEnv();
  const calls = noProvider();
  const result = await handler(request({}, { secret: "wrong" }), productionContext());
  assert.equal(result.status, 401);
  assert.equal(calls(), 0);
  assert.equal(traceState.calls.length, 0);
});

test("non-production deployment fails before authority or provider access", async () => {
  configureEnv();
  const calls = noProvider();
  const result = await handler(
    request(),
    productionContext({ deploy: { context: "deploy-preview", id: "fixture", published: false } }),
  );
  assert.equal((await bodyOf(result)).code, "RUNTIME_ENVIRONMENT_MISMATCH");
  assert.equal(calls(), 0);
  assert.equal(traceState.calls.length, 0);
});

test("wrong site fails before authority or provider access", async () => {
  configureEnv();
  const calls = noProvider();
  const result = await handler(
    request(),
    productionContext({ site: { id: "wrong-site", name: "wrong" } }),
  );
  assert.equal((await bodyOf(result)).code, "RUNTIME_ENVIRONMENT_MISMATCH");
  assert.equal(calls(), 0);
  assert.equal(traceState.calls.length, 0);
});

for (const [name, mutation] of [
  ["authority above A0", { authority: "A3" }],
  ["wrong resource", { resourceId: "C-WRONG" }],
  ["wrong binding", { bindingId: "CB-WRONG" }],
  ["wrong environment", { environment: "QA / Test" }],
  ["wrong token class", { tokenClass: "USER" }],
]) {
  test(`${name} fails before authority or provider access`, async () => {
    configureEnv();
    const calls = noProvider();
    const result = await handler(request(mutation), productionContext());
    assert.equal((await bodyOf(result)).code, "INVOCATION_ENVELOPE_MISMATCH");
    assert.equal(calls(), 0);
    assert.equal(traceState.calls.length, 0);
  });
}

test("missing canonical trace envelope fails before authority or provider access", async () => {
  configureEnv();
  const calls = noProvider();
  const result = await handler(request({ runtimeRunId: "", releaseId: "" }), productionContext());
  assert.equal((await bodyOf(result)).code, "TRACE_ENVELOPE_INCOMPLETE");
  assert.equal(calls(), 0);
  assert.equal(traceState.calls.length, 0);
});

test("missing canonical Command fails closed before Runtime Run and Slack", async () => {
  configureEnv({}, { commandRecords: [] });
  const calls = noProvider();
  const result = await handler(request(), productionContext());
  assert.equal((await bodyOf(result)).code, "COMMAND_NOT_FOUND");
  assert.equal(calls(), 0);
  assert.equal(traceState.calls.length, 1);
});

test("unapproved canonical Command fails closed before Slack", async () => {
  configureEnv({}, { commandRecords: [canonicalCommand({ Status: "Draft" })] });
  const calls = noProvider();
  const result = await handler(request(), productionContext());
  assert.equal((await bodyOf(result)).code, "COMMAND_NOT_APPROVED");
  assert.equal(calls(), 0);
  assert.equal(traceState.calls.length, 1);
});

test("release target/resource drift fails closed before Slack", async () => {
  configureEnv({}, { releaseRecords: [canonicalRelease({ "Target Resource": "channel:C-WRONG" })] });
  const calls = noProvider();
  const result = await handler(request(), productionContext());
  assert.equal((await bodyOf(result)).code, "RELEASE_TARGET_RESOURCE_MISMATCH");
  assert.equal(calls(), 0);
  assert.equal(traceState.calls.length, 2);
});

test("release action scope must explicitly preserve A0 zero-write Slack methods", async () => {
  configureEnv({}, { releaseRecords: [canonicalRelease({ "Allowed Fields / Action": "A0 auth.test only" })] });
  const calls = noProvider();
  const result = await handler(request(), productionContext());
  assert.equal((await bodyOf(result)).code, "RELEASE_ACTION_SCOPE_MISMATCH");
  assert.equal(calls(), 0);
  assert.equal(traceState.calls.length, 2);
});

test("approval separation-of-duties must pass before Slack", async () => {
  configureEnv({}, { approvalRecords: [canonicalApproval({ "Separation of Duties Check": "Failed" })] });
  const calls = noProvider();
  const result = await handler(request(), productionContext());
  assert.equal((await bodyOf(result)).code, "APPROVAL_SOD_NOT_PASSED");
  assert.equal(calls(), 0);
  assert.equal(traceState.calls.length, 3);
});

test("runtime run replay fails closed after authority revalidation and before Slack", async () => {
  configureEnv();
  traceState.replayRuntimeRun = true;
  const calls = noProvider();
  const result = await handler(request(), productionContext());
  assert.equal((await bodyOf(result)).code, "RUNTIME_RUN_ID_REPLAY");
  assert.equal(calls(), 0);
  assert.equal(traceState.calls.length, 4);
});

test("scope expansion fails closed after authorized auth.test and is traced", async () => {
  configureEnv();
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(String(url));
    return response(exactIdentity, `${exactScopes},chat:write`);
  };
  const result = await handler(request(), productionContext());
  assert.equal((await bodyOf(result)).code, "SCOPE_CEILING_MISMATCH");
  assert.deepEqual(paths, ["https://slack.com/api/auth.test"]);
  assert.equal(traceState.calls.length, 8);
});

test("identity substitution fails closed after canonical authority validation", async () => {
  configureEnv();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response({ ...exactIdentity, team_id: "T-WRONG" });
  };
  const result = await handler(request(), productionContext());
  assert.equal((await bodyOf(result)).code, "PROVIDER_IDENTITY_MISMATCH");
  assert.equal(calls, 1);
  assert.equal(traceState.calls.length, 8);
});

test("PRECHECK validates authority before Runtime Run and returns zero-content metadata", async () => {
  configureEnv();
  const paths = [];
  globalThis.fetch = async (url, init) => {
    paths.push(String(url));
    assert.equal(init.method, "GET");
    assert.equal(init.headers.authorization, "Bearer fixture-bot-token");
    return response(exactIdentity);
  };
  const result = await handler(request(), productionContext());
  const body = await bodyOf(result);
  assert.equal(result.status, 200);
  assert.equal(body.state, "PRECHECK_PASS");
  assert.equal(body.contentReads, 0);
  assert.equal(body.providerWrites, 0);
  assert.deepEqual(paths, ["https://slack.com/api/auth.test"]);
  assert.equal(traceState.calls.length, 8);
  const runtimeCreate = traceState.calls[4].body.records[0].fields;
  assert.match(runtimeCreate.Notes, /"authority_validated":true/);
  assert.match(runtimeCreate.Notes, /rec-command-fixture/);
  assert.match(runtimeCreate.Notes, /rec-release-fixture/);
  assert.match(runtimeCreate.Notes, /rec-approval-fixture/);
});

test("READ_CANARY gate-off permits only authorized auth.test and no content read", async () => {
  configureEnv();
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(String(url));
    return response(exactIdentity);
  };
  const result = await handler(request({ operation: "READ_CANARY" }), productionContext());
  const body = await bodyOf(result);
  assert.equal(body.state, "HOLD");
  assert.equal(body.contentReads, 0);
  assert.deepEqual(paths, ["https://slack.com/api/auth.test"]);
  assert.equal(traceState.calls.length, 8);
});

test("eligible fixture canary reads one allowlisted message and never stores raw text", async () => {
  configureEnv({ NEXT_SLACK_R1_BINDING_ACTIVE: "true", NEXT_SLACK_R1_CANARY_ENABLED: "true" });
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(String(url));
    if (String(url).endsWith("/auth.test")) return response(exactIdentity);
    return response({
      ok: true,
      messages: [{ ts: "1.2", subtype: "bot_message", text: "fixture message" }],
    });
  };
  const result = await handler(request({ operation: "READ_CANARY" }), productionContext());
  const body = await bodyOf(result);
  assert.equal(result.status, 200);
  assert.equal(body.providerWrites, 0);
  assert.equal(body.contentReads, 1);
  assert.equal(body.rawMessageContentReturned, false);
  assert.equal(JSON.stringify(body).includes("fixture message"), false);
  assert.deepEqual(paths, [
    "https://slack.com/api/auth.test",
    "https://slack.com/api/conversations.history?channel=C0BCCH6PYAE&limit=1",
  ]);
  assert.equal(traceState.calls.length, 8);
  const traceBodies = JSON.stringify(traceState.calls.map((call) => call.body));
  assert.equal(traceBodies.includes("fixture message"), false);
  assert.equal(traceBodies.includes("fixture-bot-token"), false);
  assert.match(traceBodies, /textSha256/);
});
