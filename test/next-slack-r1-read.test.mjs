import assert from "node:assert/strict";
import test from "node:test";

const { default: handler } = await import(
  new URL("../netlify/functions/next-slack-r1-read.mts", import.meta.url)
);

const exactBindingId =
  "CB-NEXT-SLACK-R1-A0BVA18EG4D-T0BC95ACRU5-PROD-A0-C0BCCH6PYAE";
const exactScopes = "channels:history,channels:read";
const exactIdentity = {
  ok: true,
  team_id: "T0BC95ACRU5",
  user_id: "U0BV7SX3R1U",
  bot_id: "B0BV5DPEQDZ",
};

function configureEnv(overrides = {}) {
  const values = new Map(
    Object.entries({
      NEXT_SLACK_R1_RUNTIME_SECRET: "fixture-runtime-secret",
      NEXT_SLACK_R1_BOT_TOKEN: "fixture-bot-token",
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
    site: { id: "fixture-site", name: "fixture", url: "https://fixture.invalid" },
    ...overrides,
  };
}

async function bodyOf(result) {
  return await result.json();
}

test("missing credentials holds before provider access", async () => {
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
  });
}

test("scope expansion fails closed after auth.test", async () => {
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
});

test("identity substitution fails closed", async () => {
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
});

test("PRECHECK performs auth.test only and returns no content or secret", async () => {
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
  assert.deepEqual(paths, ["https://slack.com/api/auth.test"]);
  assert.equal(JSON.stringify(body).includes("fixture-bot-token"), false);
  assert.equal(JSON.stringify(body).includes("fixture-runtime-secret"), false);
});

test("READ_CANARY gate-off stops before conversations.history", async () => {
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
});

test("eligible fixture canary is pinned to one channel/message and returns no raw text", async () => {
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
});
