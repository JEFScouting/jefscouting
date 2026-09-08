import {
  beginCanonicalTrace,
  finishCanonicalTrace,
} from "./_next-slack-r1-trace.mts";

const SLACK_API_BASE = "https://slack.com/api";

const BINDING = Object.freeze({
  bindingId: "CB-NEXT-SLACK-R1-A0BVA18EG4D-T0BC95ACRU5-PROD-A0-C0BCCH6PYAE",
  environment: "Production / Live",
  deployContext: "production",
  siteId: "2d5cef57-c959-403d-b518-ca5c40ec0462",
  authority: "A0",
  tokenClass: "BOT",
  workspaceId: "T0BC95ACRU5",
  channelId: "C0BCCH6PYAE",
  apiAppId: "A0BVA18EG4D",
  botUserId: "U0BV7SX3R1U",
  botId: "B0BV5DPEQDZ",
  scopes: ["channels:history", "channels:read"] as const,
});

const MAX_CANARY_MESSAGES = 1;

type Operation = "PRECHECK" | "READ_CANARY";

type InvocationRequest = {
  operation?: Operation;
  bindingId?: string;
  environment?: string;
  authority?: string;
  tokenClass?: string;
  resourceId?: string;
  runtimeRunId?: string;
  envelopeId?: string;
  effectKey?: string;
  commandId?: string;
  releaseId?: string;
};

type RuntimeContext = {
  deploy?: {
    context?: string;
    id?: string;
    published?: boolean;
  };
  site?: {
    id?: string;
    name?: string;
    url?: string;
  };
};

type SlackAuthTest = {
  ok?: boolean;
  error?: string;
  team_id?: string;
  user_id?: string;
  bot_id?: string;
};

type SlackHistoryResponse = {
  ok?: boolean;
  error?: string;
  messages?: Array<{
    ts?: string;
    text?: string;
    subtype?: string;
  }>;
};

type TraceInput = {
  runtimeRunId: string;
  envelopeId: string;
  effectKey: string;
  commandId: string;
  releaseId: string;
  operation: Operation;
  bindingId: string;
  resourceId: string;
  deployId: string | null;
  siteId: string;
  inputHash: string;
  startedAt: string;
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function parseScopes(raw: string | null): string[] | null {
  if (!raw) return null;
  return raw
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean)
    .sort();
}

function expectedScopes(): string[] {
  return [...BINDING.scopes].sort();
}

function exactScopeMatch(observed: string[] | null): boolean {
  if (!observed) return false;
  const expected = expectedScopes();
  return (
    observed.length === expected.length &&
    observed.every((scope, index) => scope === expected[index])
  );
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function slackRead(
  path: string,
  token: string,
): Promise<{ response: Response; payload: any; scopes: string[] | null }> {
  const response = await fetch(`${SLACK_API_BASE}/${path}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
  });

  const scopes = parseScopes(response.headers.get("x-oauth-scopes"));
  const payload = await response.json().catch(() => ({}));
  return { response, payload, scopes };
}

async function runPrecheck(token: string) {
  const { response, payload, scopes } = await slackRead("auth.test", token);
  const auth = payload as SlackAuthTest;

  if (!response.ok || auth.ok !== true) {
    return {
      ok: false,
      status: 502,
      code: "SLACK_AUTH_TEST_FAILED",
      detail: auth.error ?? `HTTP_${response.status}`,
    };
  }

  if (!exactScopeMatch(scopes)) {
    return {
      ok: false,
      status: 409,
      code: scopes ? "SCOPE_CEILING_MISMATCH" : "SCOPE_HEADER_UNAVAILABLE",
      observedScopes: scopes,
      expectedScopes: expectedScopes(),
    };
  }

  if (
    auth.team_id !== BINDING.workspaceId ||
    auth.user_id !== BINDING.botUserId ||
    auth.bot_id !== BINDING.botId
  ) {
    return {
      ok: false,
      status: 409,
      code: "PROVIDER_IDENTITY_MISMATCH",
      observed: {
        workspaceId: auth.team_id ?? null,
        botUserId: auth.user_id ?? null,
        botId: auth.bot_id ?? null,
      },
      expected: {
        workspaceId: BINDING.workspaceId,
        botUserId: BINDING.botUserId,
        botId: BINDING.botId,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    bindingId: BINDING.bindingId,
    workspaceId: BINDING.workspaceId,
    channelId: BINDING.channelId,
    apiAppId: BINDING.apiAppId,
    botUserId: BINDING.botUserId,
    botId: BINDING.botId,
    scopes,
  };
}

function traceEnvelopeComplete(body: InvocationRequest): body is InvocationRequest & {
  runtimeRunId: string;
  envelopeId: string;
  effectKey: string;
  commandId: string;
  releaseId: string;
} {
  return [
    body.runtimeRunId,
    body.envelopeId,
    body.effectKey,
    body.commandId,
    body.releaseId,
  ].every((value) => typeof value === "string" && value.trim().length > 0);
}

async function finalizeTrace(
  token: string,
  runtimeRecordId: string,
  trace: TraceInput,
  outcome: string,
  terminalStatus: "Succeeded" | "Failed" | "Blocked",
  counts: { providerCalls: number; providerWrites: number; contentReads: number },
  evidenceMetadata: Record<string, unknown> = {},
) {
  const completedAt = new Date().toISOString();
  const outputHash = await sha256(
    JSON.stringify({ outcome, terminalStatus, ...counts, evidenceMetadata }),
  );
  try {
    await finishCanonicalTrace(token, runtimeRecordId, {
      ...trace,
      outcome,
      terminalStatus,
      outputHash,
      completedAt,
      ...counts,
      evidenceMetadata,
    });
    return true;
  } catch {
    return false;
  }
}

export default async (req: Request, context: RuntimeContext) => {
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  if (
    context?.deploy?.context !== BINDING.deployContext ||
    context?.deploy?.published !== true ||
    context?.site?.id !== BINDING.siteId
  ) {
    return json(
      {
        success: false,
        state: "HOLD",
        code: "RUNTIME_ENVIRONMENT_MISMATCH",
        expectedEnvironment: BINDING.environment,
        expectedDeployContext: BINDING.deployContext,
        expectedSiteId: BINDING.siteId,
        observedDeployContext: context?.deploy?.context ?? null,
        observedSiteId: context?.site?.id ?? null,
        published: context?.deploy?.published === true,
        providerWrites: 0,
        contentReads: 0,
      },
      409,
    );
  }

  const runtimeSecret = Netlify.env.get("NEXT_SLACK_R1_RUNTIME_SECRET");
  const botToken = Netlify.env.get("NEXT_SLACK_R1_BOT_TOKEN");
  const airtableToken = Netlify.env.get("NEXT_SLACK_R1_AIRTABLE_TOKEN");

  if (!runtimeSecret || !botToken || !airtableToken) {
    return json(
      {
        success: false,
        state: "HOLD",
        code: "RUNTIME_CONFIGURATION_INCOMPLETE",
        error: "Dedicated Slack R1 runtime is not fully configured",
        providerWrites: 0,
        contentReads: 0,
      },
      503,
    );
  }

  const authorization = req.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${runtimeSecret}`) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: InvocationRequest = {};
  try {
    body = (await req.json()) as InvocationRequest;
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  const operation = body.operation;
  if (operation !== "PRECHECK" && operation !== "READ_CANARY") {
    return json({ success: false, error: "Unsupported operation" }, 400);
  }

  const envelopeMatches = {
    bindingId: body.bindingId === BINDING.bindingId,
    environment: body.environment === BINDING.environment,
    authority: body.authority === BINDING.authority,
    tokenClass: body.tokenClass === BINDING.tokenClass,
    resourceId: body.resourceId === BINDING.channelId,
  };

  if (Object.values(envelopeMatches).some((matches) => !matches)) {
    return json(
      {
        success: false,
        state: "HOLD",
        operation,
        code: "INVOCATION_ENVELOPE_MISMATCH",
        envelopeMatches,
        providerWrites: 0,
        contentReads: 0,
      },
      409,
    );
  }

  if (!traceEnvelopeComplete(body)) {
    return json(
      {
        success: false,
        state: "HOLD",
        operation,
        code: "TRACE_ENVELOPE_INCOMPLETE",
        providerWrites: 0,
        contentReads: 0,
      },
      409,
    );
  }

  const startedAt = new Date().toISOString();
  const inputHash = await sha256(
    JSON.stringify({
      operation,
      bindingId: body.bindingId,
      environment: body.environment,
      authority: body.authority,
      tokenClass: body.tokenClass,
      resourceId: body.resourceId,
      runtimeRunId: body.runtimeRunId,
      envelopeId: body.envelopeId,
      effectKey: body.effectKey,
      commandId: body.commandId,
      releaseId: body.releaseId,
      deployId: context.deploy?.id ?? null,
      siteId: BINDING.siteId,
    }),
  );

  const trace: TraceInput = {
    runtimeRunId: body.runtimeRunId,
    envelopeId: body.envelopeId,
    effectKey: body.effectKey,
    commandId: body.commandId,
    releaseId: body.releaseId,
    operation,
    bindingId: BINDING.bindingId,
    resourceId: BINDING.channelId,
    deployId: context.deploy?.id ?? null,
    siteId: BINDING.siteId,
    inputHash,
    startedAt,
  };

  let runtimeRecordId: string;
  try {
    const start = await beginCanonicalTrace(airtableToken, trace);
    if (!start.ok) {
      return json(
        {
          success: false,
          state: "HOLD",
          operation,
          code: start.code,
          providerWrites: 0,
          contentReads: 0,
        },
        409,
      );
    }
    runtimeRecordId = start.recordId;
  } catch {
    return json(
      {
        success: false,
        state: "HOLD",
        operation,
        code: "TRACE_PREINVOKE_PERSISTENCE_FAILED",
        providerWrites: 0,
        contentReads: 0,
      },
      503,
    );
  }

  let providerCalls = 0;
  let contentReads = 0;

  try {
    providerCalls += 1;
    const precheck = await runPrecheck(botToken);
    if (!precheck.ok) {
      const traced = await finalizeTrace(
        airtableToken,
        runtimeRecordId,
        trace,
        "PRECHECK_BLOCKED",
        "Blocked",
        { providerCalls, providerWrites: 0, contentReads },
        { code: precheck.code },
      );
      if (!traced) {
        return json(
          {
            success: false,
            state: "HOLD",
            operation,
            code: "TRACE_PERSISTENCE_FAILED",
            providerWrites: 0,
            contentReads,
          },
          503,
        );
      }
      return json(
        {
          success: false,
          state: "HOLD",
          operation,
          bindingId: BINDING.bindingId,
          ...precheck,
        },
        precheck.status,
      );
    }

    if (operation === "PRECHECK") {
      const evidenceMetadata = {
        workspaceId: precheck.workspaceId,
        channelId: precheck.channelId,
        apiAppId: precheck.apiAppId,
        botUserId: precheck.botUserId,
        botId: precheck.botId,
        scopes: precheck.scopes,
        rawProviderContentStored: false,
      };
      const traced = await finalizeTrace(
        airtableToken,
        runtimeRecordId,
        trace,
        "PRECHECK_VERIFIED_TECHNICAL",
        "Succeeded",
        { providerCalls, providerWrites: 0, contentReads },
        evidenceMetadata,
      );
      if (!traced) {
        return json(
          {
            success: false,
            state: "HOLD",
            operation,
            code: "TRACE_PERSISTENCE_FAILED",
            providerWrites: 0,
            contentReads: 0,
          },
          503,
        );
      }
      return json({
        success: true,
        state: "PRECHECK_PASS",
        operation,
        observedAt: new Date().toISOString(),
        providerWrites: 0,
        contentReads: 0,
        runtimeRunId: body.runtimeRunId,
        deployment: {
          context: context.deploy?.context,
          deployId: context.deploy?.id ?? null,
          published: true,
          siteId: context.site?.id ?? null,
        },
        ...precheck,
      });
    }

    const activeBindingId = Netlify.env.get("NEXT_SLACK_R1_ACTIVE_BINDING_ID");
    const bindingActive = Netlify.env.get("NEXT_SLACK_R1_BINDING_ACTIVE") === "true";
    const canaryEnabled = Netlify.env.get("NEXT_SLACK_R1_CANARY_ENABLED") === "true";

    if (
      !bindingActive ||
      !canaryEnabled ||
      activeBindingId !== BINDING.bindingId
    ) {
      const traced = await finalizeTrace(
        airtableToken,
        runtimeRecordId,
        trace,
        "BLOCKED_PRE_CANARY",
        "Blocked",
        { providerCalls, providerWrites: 0, contentReads },
        {
          bindingActive,
          canaryEnabled,
          activeBindingMatches: activeBindingId === BINDING.bindingId,
        },
      );
      if (!traced) {
        return json(
          {
            success: false,
            state: "HOLD",
            operation,
            code: "TRACE_PERSISTENCE_FAILED",
            providerWrites: 0,
            contentReads: 0,
          },
          503,
        );
      }
      return json(
        {
          success: false,
          state: "HOLD",
          operation,
          error: "R1 content-read canary is not authorized by runtime gate",
          requiredBindingId: BINDING.bindingId,
          bindingActive,
          canaryEnabled,
          activeBindingMatches: activeBindingId === BINDING.bindingId,
          providerWrites: 0,
          contentReads: 0,
          runtimeRunId: body.runtimeRunId,
        },
        409,
      );
    }

    const historyPath =
      `conversations.history?channel=${encodeURIComponent(BINDING.channelId)}` +
      `&limit=${MAX_CANARY_MESSAGES}`;

    providerCalls += 1;
    contentReads = 1;
    const { response, payload, scopes } = await slackRead(historyPath, botToken);
    const history = payload as SlackHistoryResponse;

    if (!response.ok || history.ok !== true) {
      const traced = await finalizeTrace(
        airtableToken,
        runtimeRecordId,
        trace,
        "CANARY_READ_FAILED",
        "Failed",
        { providerCalls, providerWrites: 0, contentReads },
        { code: history.error ?? `HTTP_${response.status}` },
      );
      if (!traced) {
        return json(
          {
            success: false,
            state: "HOLD",
            operation,
            code: "TRACE_PERSISTENCE_FAILED",
            providerWrites: 0,
            contentReads,
          },
          503,
        );
      }
      return json(
        {
          success: false,
          state: "HOLD",
          operation,
          error: "Slack read-only canary failed",
          slackError: history.error ?? `HTTP_${response.status}`,
          providerWrites: 0,
          contentReads,
          runtimeRunId: body.runtimeRunId,
        },
        502,
      );
    }

    if (!exactScopeMatch(scopes)) {
      const traced = await finalizeTrace(
        airtableToken,
        runtimeRecordId,
        trace,
        "CANARY_SCOPE_DRIFT",
        "Blocked",
        { providerCalls, providerWrites: 0, contentReads },
        { observedScopes: scopes, expectedScopes: expectedScopes() },
      );
      if (!traced) {
        return json(
          {
            success: false,
            state: "HOLD",
            operation,
            code: "TRACE_PERSISTENCE_FAILED",
            providerWrites: 0,
            contentReads,
          },
          503,
        );
      }
      return json(
        {
          success: false,
          state: "HOLD",
          operation,
          error: "Scope ceiling changed during canary",
          observedScopes: scopes,
          expectedScopes: expectedScopes(),
          providerWrites: 0,
          contentReads,
          runtimeRunId: body.runtimeRunId,
        },
        409,
      );
    }

    const messages = Array.isArray(history.messages) ? history.messages : [];
    const first = messages[0] ?? null;
    const text = first?.text ?? "";
    const sample = first
      ? {
          ts: first.ts ?? null,
          subtype: first.subtype ?? null,
          textLength: text.length,
          textSha256: await sha256(text),
        }
      : null;

    const traced = await finalizeTrace(
      airtableToken,
      runtimeRecordId,
      trace,
      "CANARY_VERIFIED_TECHNICAL",
      "Succeeded",
      { providerCalls, providerWrites: 0, contentReads },
      {
        workspaceId: BINDING.workspaceId,
        channelId: BINDING.channelId,
        apiAppId: BINDING.apiAppId,
        botUserId: BINDING.botUserId,
        botId: BINDING.botId,
        scopes,
        messagesObserved: messages.length,
        sample,
        rawProviderContentStored: false,
      },
    );
    if (!traced) {
      return json(
        {
          success: false,
          state: "HOLD",
          operation,
          code: "TRACE_PERSISTENCE_FAILED",
          providerWrites: 0,
          contentReads,
        },
        503,
      );
    }

    return json({
      success: true,
      state: "CANARY_READ_PASS",
      operation,
      observedAt: new Date().toISOString(),
      bindingId: BINDING.bindingId,
      workspaceId: BINDING.workspaceId,
      channelId: BINDING.channelId,
      apiAppId: BINDING.apiAppId,
      botUserId: BINDING.botUserId,
      botId: BINDING.botId,
      scopes,
      providerWrites: 0,
      contentReads,
      runtimeRunId: body.runtimeRunId,
      messagesObserved: messages.length,
      sample,
      rawMessageContentReturned: false,
    });
  } catch (error) {
    const failureClass = error instanceof Error ? error.name : "UnknownError";
    console.error("NEXT Slack R1 governed read failure", { failureClass });
    const traced = await finalizeTrace(
      airtableToken,
      runtimeRecordId,
      trace,
      "UNKNOWN_HELD",
      "Blocked",
      { providerCalls, providerWrites: 0, contentReads },
      { failureClass },
    );
    return json(
      {
        success: false,
        state: "HOLD",
        operation,
        code: traced ? "UNKNOWN_HELD" : "TRACE_PERSISTENCE_FAILED",
        error: "NEXT Slack R1 governed read failed",
        providerWrites: 0,
        contentReads,
        automaticRetry: false,
        runtimeRunId: body.runtimeRunId,
      },
      500,
    );
  }
};

export const config = {
  path: "/api/next-slack-r1-read",
};
