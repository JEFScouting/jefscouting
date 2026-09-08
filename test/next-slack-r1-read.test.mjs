import assert from "node:assert/strict";
import test from "node:test";

const { default: handler } = await import(
  new URL("../netlify/functions/next-slack-r1-read.mts", import.meta.url)
);

const exactBindingId =
  "CB-NEXT-SLACK-R1-A0BVA18EG4D-T0BC95ACRU5-PROD-A0-C0BCCH6PYAE";
const exactSiteId = "2d5cef57-c959-403d-b518-ca5c40ec0462";
const exactScopes = "channels:history,channels:read";
const exactIdentity = {
  ok: true,
  team_id: "T0BC95ACRU5",
  user_id: "U0BV7SX3R1U",
  bot_id: "B0BV5DPEQDZ",
};

let traceState;

function configureTraceMock() {
  traceState = {
    calls: [],
    replayRuntimeRun: false,
  };
  globalThis.__NEXT_SLACK_R1_TRACE_FETCH = async (url, init = {}) => {
    const stringUrl = String(url);
    const method = init.method ?? "GET";
    const parsedBody = init.body ? JSON.parse(String(init.body)) : null;
    traceState.calls.push({ url: stringUrl, method, body: parsedBody });

    assert.equal(init.headers.authorization, "Bearer fixture-airtable-token");

    if (
      method === "GET" &&
      stringUrl.includes("appBUnJ5tQSKXAoA2/tblNe1vDlPjcSDEDC")
    ) {
      return Response.json({
        records: traceState.replayRuntimeRun
          ? [{ id: "rec-existing-runtime", fields: { "Run ID": "RUN-FIXTURE" } }]
          : [],
      });
    }

    if (
      method === "POST" &&
      stringUrl.endsWith("appBUnJ5tQSKXAoA2/tblNe1vDlPjcSDEDC")
    ) {
      return Response.json({ records: [{ id: "rec-runtime-fixture" }] });
    }

    if (
      method === "PATCH" &&
      stringUrl.endsWith("appBUnJ5tQSKXAoA2/tblNe1vDlPjcSDEDC")
    ) {
      return Response.json({ records: [{ id: "rec-runtime-fixture" }] });
    }

    if (
      method === "POST" &&
      stringUrl.endsWith("appBUnJ5tQSKXAoA2/tblcDIssO3HoqsxuZ")
    ) {
      return Response.json({ records: [{ id: "rec-event-fixture" }] });
    }

    if (
      method === "POST" &&
      stringUrl.endsWith("appveHEw1HrXr8nD1/tblmeZC1GiM0R6VhK")
    ) {
      return Response.json({ records: [{ id: "rec-evidence-fixture" }] });
    }

    return Response.json({ error: { type: "UNEXPECTED_TRACE_REQUEST" } }, { status: 500 });
  };
}

function configureEnv(overrides = {}) {
  configureTraceMock();
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

function request(body, options = {}) {
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
    commandId: "CMD-NEXT-SLACK-R1-FIXTURE",
    releaseId: "REL-NEXT-SLACK-R1-FIXTURE",
    ...body,
  };
  return new Request("https://fixture.invalid/api/next-slack-r1-read", {
    method: options.method ?? "POST",
    headers: {
      authorization: `Bearer ${options.secret ?? "fixture-runtime-secret"}`,
      "content-type": "application/json",
    },
    body:
      (options.method ?? "POST") === "POST"
        ? JSON.stringify(envelope)
        : undefined,
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

test("missing provider credential holds before provider access", async () => {
  configureEnv({ NEXT_SLACK_R1_BOT_TOKEN: "" });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("unexpected provider call");
  };
  const result = await handler(request({}), productionContext());
  assert.equal(result.status, 503);
  assert.equal((await bodyOf(result)).state, "HOLD");
  assert.equal(calls, 0);
  assert.equal(traceState.calls.length, 0);
});

test("missing Airtable trace credential holds before provider access", async () => {
  configureEnv({ NEXT_SLACK_R1_AIRTABLE_TOKEN: "" });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("unexpected provider call");
  };
  const result = await handler(request({}), productionContext());
  const body = await bodyOf(result);
  assert.equal(result.status, 503);
  assert.equal(body.code, "RUNTIME_CONFIGURATION_INCOMPLETE");
  assert.equal(calls, 0);
  assert.equal(traceState.calls.length, 0);
});

test("wrong runtime secret is rejected before provider access", async () => {
  configureEnv();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("unexpected provider call");
  };
  const result = await handler(
    request({}, { secret: "wrong" }),
    productionContext(),
  );
  assert.equal(result.status, 401);
  assert.equal(calls, 0);
  assert.equal(traceState.calls.length, 0);
});

test("unsupported operation cannot reach Slack", async () => {
  configureEnv();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("unexpected provider call");
  };
  const result = await handler(
    request({ operation: "WRITE", authority: "A3" }),
    productionContext(),
  );
  assert.equal(result.status, 400);
  assert.equal(calls, 0);
  assert.equal(traceState.calls.length, 0);
});

test("non-production deployment fails before provider access", async () => {
  configureEnv();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(exactIdentity);
  };
  const result = await handler(
    request({}),
    productionContext({
      deploy: { context: "deploy-preview", id: "fixture", published: false },
    }),
  );
  const body = await bodyOf(result);
  assert.equal(result.status, 409);
  assert.equal(body.state, "HOLD");
  assert.equal(body.code, "RUNTIME_ENVIRONMENT_MISMATCH");
  assert.equal(calls, 0);
  assert.equal(traceState.calls.length, 0);
});

test("wrong Netlify site fails before provider access", async () => {
  configureEnv();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(exactIdentity);
  };
  const result = await handler(
    request({}),
    productionContext({
      site: { id: "wrong-site", name: "wrong", url: "https://wrong.invalid" },
    }),
  );
  const body = await bodyOf(result);
  assert.equal(result.status, 409);
  assert.equal(body.state, "HOLD");
  assert.equal(body.code, "RUNTIME_ENVIRONMENT_MISMATCH");
  assert.equal(body.expectedSiteId, exactSiteId);
  assert.equal(body.observedSiteId, "wrong-site");
  assert.equal(calls, 0);
  assert.equal(traceState.calls.length, 0);
});

for (const [name, mutation] of [
  ["authority above A0", { authority: "A3" }],
  ["wrong resource", { resourceId: "C-WRONG" }],
  ["wrong binding", { bindingId: "CB-WRONG" }],
  ["wrong environment", { environment: "QA / Test" }],
  ["wrong token class", { tokenClass: "USER" }],
]) {
  test(`${name} fails before provider access`, async () => {
    configureEnv();
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return response(exactIdentity);
    };
    const result = await handler(request(mutation), productionContext());
    const body = await bodyOf(result);
    assert.equal(result.status, 409);
    assert.equal(body.state, "HOLD");
    assert.equal(body.code, "INVOCATION_ENVELOPE_MISMATCH");
    assert.equal(calls, 0);
    assert.equal(traceState.calls.length, 0);
  });
}

test("missing canonical trace envelope fails before provider access", async () => {
  configureEnv();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(exactIdentity);
  };
  const result = await handler(
    request({ runtimeRunId: "", envelopeId: "" }),
    productionContext(),
  );
  const body = await bodyOf(result);
  assert.equal(result.status, 409);
  assert.equal(body.code, "TRACE_ENVELOPE_INCOMPLETE");
  assert.equal(calls, 0);
  assert.equal(traceState.calls.length, 0);
});

test("runtime run replay fails closed before provider access", async () => {
  configureEnv();
  traceState.replayRuntimeRun = true;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(exactIdentity);
  };
  const result = await handler(request({}), productionContext());
  const body = await bodyOf(result);
  assert.equal(result.status, 409);
  assert.equal(body.code, "RUNTIME_RUN_ID_REPLAY");
  assert.equal(calls, 0);
  assert.equal(traceState.calls.length, 1);
  assert.equal(traceState.calls[0].method, "GET");
});

test("scope expansion fails closed after auth.test and is canonically traced", async () => {
  configureEnv();
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(String(url));
    return response(exactIdentity, `${exactScopes},chat:write`);
  };
  const result = await handler(request({}), productionContext());
  const body = await bodyOf(result);
  assert.equal(result.status, 409);
  assert.equal(body.code, "SCOPE_CEILING_MISMATCH");
  assert.equal(paths.length, 1);
  assert.match(paths[0], /\/auth\.test$/);
  assert.equal(traceState.calls.length, 5);
});

test("identity substitution fails closed and is canonically traced", async () => {
  configureEnv();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response({ ...exactIdentity, team_id: "T-WRONG" });
  };
  const result = await handler(request({}), productionContext());
  const body = await bodyOf(result);
  assert.equal(result.status, 409);
  assert.equal(body.code, "PROVIDER_IDENTITY_MISMATCH");
  assert.equal(calls, 1);
  assert.equal(traceState.calls.length, 5);
});

test("PRECHECK creates Runtime Run, Event and JEF Evidence before claiming success", async () => {
  configureEnv();
  const paths = [];
  globalThis.fetch = async (url, init) => {
    paths.push(String(url));
    assert.equal(init.method, "GET");
    assert.equal(init.headers.authorization, "Bearer fixture-bot-token");
    return response(exactIdentity);
  };
  const result = await handler(request({}), productionContext());
  const body = await bodyOf(result);
  assert.equal(result.status, 200);
  assert.equal(body.state, "PRECHECK_PASS");
  assert.equal(body.contentReads, 0);
  assert.equal(body.providerWrites, 0);
  assert.equal(body.runtimeRunId, "RUN-FIXTURE");
  assert.equal(body.deployment.siteId, exactSiteId);
  assert.deepEqual(paths, ["https://slack.com/api/auth.test"]);
  assert.equal(traceState.calls.length, 5);

  const runtimeCreate = traceState.calls[1].body.records[0].fields;
  assert.equal(runtimeCreate["Run ID"], "RUN-FIXTURE");
  assert.equal(runtimeCreate["Tenant ID"], "TEN-JEF-PROD");
  assert.equal(runtimeCreate.Status, "Running");
  assert.equal(runtimeCreate["Command ID"], "CMD-NEXT-SLACK-R1-FIXTURE");

  const eventCreate = traceState.calls[3].body.records[0].fields;
  assert.equal(eventCreate["Tenant ID"], "TEN-JEF-PROD");
  assert.equal(eventCreate["Event Type"], "NEXT_SLACK_R1_PRECHECK_VERIFIED_TECHNICAL");

  const evidenceCreate = traceState.calls[4].body.records[0].fields;
  assert.equal(evidenceCreate["Evidence ID"], "EVD-RUN-FIXTURE");
  assert.equal(evidenceCreate["Evidence Type"], "Runtime Proof");
  assert.equal(
    evidenceCreate["Related Object"],
    "NEXT v2 Implementation — CP04 Slack R1 Stable Workspace Identity Binding",
  );
  assert.equal(evidenceCreate["Related Object ID"], "RUN-FIXTURE");
  assert.equal(
    evidenceCreate["File Link"],
    "https://github.com/JEFScouting/jefscouting/pull/29",
  );
  assert.equal("Record Environment" in evidenceCreate, false);

  const allTraceBodies = JSON.stringify(traceState.calls.map((call) => call.body));
  assert.equal(allTraceBodies.includes("fixture-bot-token"), false);
  assert.equal(allTraceBodies.includes("fixture-runtime-secret"), false);
  assert.equal(allTraceBodies.includes("fixture-airtable-token"), false);
});

test("READ_CANARY gate-off stops before conversations.history and records blocked trace", async () => {
  configureEnv();
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(String(url));
    return response(exactIdentity);
  };
  const result = await handler(
    request({ operation: "READ_CANARY" }),
    productionContext(),
  );
  const body = await bodyOf(result);
  assert.equal(result.status, 409);
  assert.equal(body.state, "HOLD");
  assert.equal(body.contentReads, 0);
  assert.deepEqual(paths, ["https://slack.com/api/auth.test"]);
  assert.equal(traceState.calls.length, 5);
  const eventCreate = traceState.calls[3].body.records[0].fields;
  assert.equal(eventCreate["Event Type"], "NEXT_SLACK_R1_BLOCKED_PRE_CANARY");
});

test("eligible fixture canary is pinned to one channel/message and trace stores no raw text", async () => {
  configureEnv({
    NEXT_SLACK_R1_BINDING_ACTIVE: "true",
    NEXT_SLACK_R1_CANARY_ENABLED: "true",
  });
  const paths = [];
  globalThis.fetch = async (url) => {
    paths.push(String(url));
    if (String(url).endsWith("/auth.test")) return response(exactIdentity);
    return response({
      ok: true,
      messages: [{ ts: "1.2", subtype: "bot_message", text: "fixture message" }],
    });
  };
  const result = await handler(
    request({ operation: "READ_CANARY" }),
    productionContext(),
  );
  const body = await bodyOf(result);
  assert.equal(result.status, 200);
  assert.equal(body.providerWrites, 0);
  assert.equal(body.contentReads, 1);
  assert.equal(body.rawMessageContentReturned, false);
  assert.equal(JSON.stringify(body).includes("fixture message"), false);
  assert.equal(paths.length, 2);
  assert.equal(
    paths[1],
    "https://slack.com/api/conversations.history?channel=C0BCCH6PYAE&limit=1",
  );
  assert.equal(traceState.calls.length, 5);
  const traceBodies = JSON.stringify(traceState.calls.map((call) => call.body));
  assert.equal(traceBodies.includes("fixture message"), false);
  assert.equal(traceBodies.includes("fixture-bot-token"), false);
  assert.match(traceBodies, /textSha256/);
  const eventCreate = traceState.calls[3].body.records[0].fields;
  assert.equal(eventCreate["Event Type"], "NEXT_SLACK_R1_CANARY_VERIFIED_TECHNICAL");
});
