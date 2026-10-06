import { randomBytes, timingSafeEqual } from 'node:crypto';
import { FORMS, REPRESENTATION_FORM, CLIENT_AGREEMENT_FORM, evidenceVersion, normalizeSubmission, text, type Lane } from './intake-normalize.mts';

type Store = {
  getWithMetadata: (key: string, options: any) => Promise<any>;
  setJSON: (key: string, value: any, options: any) => Promise<any>;
  list: (options: { prefix: string; paginate: true }) => AsyncIterable<any>;
};
type Dependencies = { store: Store; env: (key: string) => string | undefined; fetch: typeof fetch; log: (value: any) => void; now: () => string };
const token = () => randomBytes(32).toString('hex');
const equal = (a: unknown, b: unknown) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const response = (status: number, data: any) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
const read = (store: Store, key: string) => store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
const terminal = (status: string) => ['done', 'exception', 'failed'].includes(status);

// Strong compare-and-swap serializes each existing Airtable automation.
// A claimed slot never expires: a slow writer must not overlap its replacement.
async function cas(store: Store, key: string, data: any, previous?: any) {
  const result = await store.setJSON(key, data, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
  if (!result.modified || !result.etag) return false;
  const verify = await read(store, key);
  return !!verify && verify.etag === result.etag;
}

export async function handleIntake(req: Request, lane: Lane, deps: Dependencies): Promise<Response> {
  const { store, env, log, now } = deps;
  const laneKey = `lane/${lane}`;
  const dispatchPaused = () => env(`JEF_${lane.toUpperCase()}_INTAKE_DISPATCH_PAUSED`) === 'true';
  const validReceipt = (v: unknown) => typeof v === 'string' && new RegExp(`^receipt/${lane}/[0-9]{16,22}/[a-f0-9]{64}$`).test(v);
  const authorized = () => !!env('JOTFORM_ADMIN_SECRET') && equal(req.headers.get('authorization'), `Bearer ${env('JOTFORM_ADMIN_SECRET')}`);
  const webhook = () => {
    if (env(`JEF_${lane.toUpperCase()}_INTAKE_V2_ENABLED`) !== 'true') throw new Error('INTAKE_NOT_ENABLED');
    const value = env(lane === 'candidate' ? 'AIRTABLE_CANDIDATE_JOTFORM_WEBHOOK_URL' : 'AIRTABLE_CLIENT_JOTFORM_WEBHOOK_URL');
    const url = new URL(value || '');
    if (url.protocol !== 'https:' || url.hostname !== 'hooks.airtable.com' || !url.pathname.includes('/appveHEw1HrXr8nD1/')) throw new Error('INVALID_AIRTABLE_DESTINATION');
    return url.toString();
  };
  const receipts = async () => {
    const result: any[] = [];
    for await (const page of store.list({ prefix: `receipt/${lane}/`, paginate: true })) {
      for (const item of page.blobs) {
        const value = await read(store, item.key);
        if (value) result.push({ key: item.key, ...value });
      }
    }
    return result.sort((a, b) => String(a.data.envelope.receivedAt).localeCompare(String(b.data.envelope.receivedAt)));
  };
  const equivalentReceipt = async (prefix: string, version: string) => {
    const matches: Array<{ key: string; value: any }> = [];
    for await (const page of store.list({ prefix, paginate: true })) {
      for (const item of page.blobs) {
        const value = await read(store, item.key);
        if (value && evidenceVersion(value.data?.envelope?.snapshot) === version) matches.push({ key: item.key, value });
      }
    }
    const rank = (status: string) => ['done', 'exception'].includes(status) ? 0 : ['claimed', 'dispatching', 'queued'].includes(status) ? 1 : status === 'failed' ? 2 : 3;
    return matches.sort((a, b) => rank(a.value.data.status) - rank(b.value.data.status))[0] || null;
  };
  const inspect = (key: string, value: any) => value ? {
    receiptId: key, status: value.data.status, receivedAt: value.data.envelope.receivedAt,
    claimedAt: value.data.claimedAt || null, completedAt: value.data.completedAt || null,
    result: value.data.result || null,
  } : null;
  // Persist submissions before dispatch, including while another submission runs.
  // Completion dispatches the next receipt without an Owner execution cycle.
  const dispatch = async (preferred = '') => {
    const hook = webhook();
    // The existing durable queue bridges human review of the native draft.
    // Intake remains recoverable while neither old nor new actions are invoked.
    // Already claimed writers can still acknowledge their completion.
    if (dispatchPaused()) {
      log({ lane, receiptId: preferred, status: 'queued_pending_activation' });
      return 'queued_pending_activation';
    }
    let slot = await read(store, laneKey);
    if (!slot) { await cas(store, laneKey, { state: 'idle' }); slot = await read(store, laneKey); }
    if (!slot) throw new Error('SLOT_UNAVAILABLE');
    if (slot.data.state === 'active') {
      const active = await read(store, slot.data.receiptId);
      if (!active) throw new Error('ACTIVE_RECEIPT_MISSING');
      if (terminal(active.data.status)) {
        if (!await cas(store, laneKey, { state: 'idle', lastReceiptId: slot.data.receiptId }, slot)) return 'queued';
        slot = await read(store, laneKey);
      } else if (active.data.status === 'claimed' || (preferred && slot.data.receiptId !== preferred)) return 'queued';
    }
    if (slot.data.state === 'idle') {
      const pending = (await receipts()).find(r => r.data.status === 'queued');
      if (!pending) return 'idle';
      const receiptToken = token();
      if (!await cas(store, laneKey, { ...slot.data, state: 'active', receiptId: pending.key, token: receiptToken, receivedAt: now() }, slot)) return 'queued';
      slot = await read(store, laneKey);
      if (slot?.data.token !== receiptToken) return 'queued';
    }
    const key = slot.data.receiptId;
    let current = await read(store, key);
    if (!current) throw new Error('ACTIVE_RECEIPT_MISSING');
    if (current.data.status === 'queued') {
      if (!await cas(store, key, { ...current.data, token: slot.data.token, status: 'dispatching' }, current)) return 'queued';
      current = await read(store, key);
    }
    if (current.data.status !== 'dispatching' || current.data.token !== slot.data.token) return 'queued';
    // Resending an unclaimed receipt is safe. All native runs share this token;
    // only one can atomically change dispatching to claimed.
    const payload = { protocol: 'JEF-INTAKE-2', lane, receiptId: key, token: current.data.token, submissionId: current.data.envelope.submissionId, sourceEventKey: current.data.envelope.sourceKey };
    const destination = await deps.fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    if (!destination.ok) {
      log({ lane, receiptId: key, status: 'delivery_uncertain', code: `AIRTABLE_HTTP_${destination.status}` });
      throw new Error('DELIVERY_UNCERTAIN');
    }
    log({ lane, receiptId: key, status: 'accepted_pending_airtable' });
    return 'accepted_pending_airtable';
  };
  let receiptId = '';
  try {
    if (req.method === 'GET') {
      if (!authorized()) return response(401, { error: 'UNAUTHORIZED' });
      const slot = await read(store, laneKey);
      const all = await receipts();
      const selected = new URL(req.url).searchParams.get('receiptId');
      if (selected && !validReceipt(selected)) return response(400, { error: 'INVALID_RECEIPT_ID' });
      return response(200, {
        lane, state: slot?.data?.state || 'idle',
        enabled: env(`JEF_${lane.toUpperCase()}_INTAKE_V2_ENABLED`) === 'true',
        dispatchPaused: dispatchPaused(),
        agreementEnabled: env(lane === 'candidate' ? 'JEF_REPRESENTATION_INTAKE_ENABLED' : 'JEF_CLIENT_AGREEMENT_INTAKE_ENABLED') === 'true',
        active: slot?.data?.state === 'active' ? inspect(slot.data.receiptId, await read(store, slot.data.receiptId)) : null,
        last: slot?.data?.lastReceiptId ? inspect(slot.data.lastReceiptId, await read(store, slot.data.lastReceiptId)) : null,
        receipt: selected ? inspect(selected, await read(store, selected)) : null,
        counts: Object.fromEntries(['queued', 'dispatching', 'claimed', 'done', 'exception', 'failed'].map(status => [status, all.filter(v => v.data.status === status).length])),
        attention: all.filter(v => ['queued', 'dispatching', 'claimed', 'failed', 'exception'].includes(v.data.status)).slice(-50).map(v => inspect(v.key, v)),
      });
    }
    if (req.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' });
    if (Number(req.headers.get('content-length') || 0) > 1000000) return response(413, { error: 'PAYLOAD_TOO_LARGE' });
    if ((req.headers.get('content-type') || '').includes('application/json')) {
      let body: any;
      try { body = await req.json(); } catch { return response(400, { error: 'INVALID_JSON' }); }
      if (!['claim', 'assertClaim', 'complete', 'retry'].includes(body?.action) || !validReceipt(body.receiptId)) return response(400, { error: 'INVALID_CONTROL_REQUEST' });
      receiptId = body.receiptId;
      const receipt = await read(store, receiptId);
      if (body.action === 'retry') {
        if (!authorized()) return response(401, { error: 'UNAUTHORIZED' });
        if (!receipt) return response(404, { error: 'RECEIPT_NOT_FOUND' });
        if (receipt.data.status === 'claimed') return response(409, { error: 'ACTIVE_WRITER_REQUIRES_REVIEW' });
        if (['done', 'exception'].includes(receipt.data.status)) return response(200, { replay: true, status: receipt.data.status });
        if (receipt.data.status === 'failed' && !await cas(store, receiptId, { ...receipt.data, status: 'queued', token: null, consumerToken: null }, receipt)) return response(409, { error: 'RETRY_RACE' });
        return response(202, { status: await dispatch(receiptId) });
      }
      if (!receipt || !equal(body.token, receipt.data.token)) return response(403, { error: 'INVALID_RECEIPT' });
      const slot = await read(store, laneKey);
      if (body.action === 'assertClaim') {
        // Read-only proof for the currently executing native writer. Never
        // extends a claim, releases a lane or authorizes another receipt.
        const held = receipt.data.status === 'claimed' &&
          equal(body.consumerToken, receipt.data.consumerToken) &&
          slot?.data?.state === 'active' && slot.data.receiptId === receiptId &&
          equal(slot.data.token, body.token);
        return response(held ? 200 : 409, { held });
      }
      if (body.action === 'claim') {
        if (['done', 'exception'].includes(receipt.data.status)) return response(200, { skip: true, status: receipt.data.status });
        if (!slot || slot.data.receiptId !== receiptId || !equal(slot.data.token, body.token) || receipt.data.status !== 'dispatching') return response(409, { error: 'ALREADY_CLAIMED_OR_NOT_ACTIVE' });
        const consumerToken = token();
        if (!await cas(store, receiptId, { ...receipt.data, status: 'claimed', claimedAt: now(), consumerToken }, receipt)) return response(409, { error: 'CLAIM_RACE' });
        return response(200, { skip: false, consumerToken, envelope: receipt.data.envelope });
      }
      if (!equal(body.consumerToken, receipt.data.consumerToken) || !['done', 'exception', 'failed'].includes(body.status)) return response(403, { error: 'INVALID_COMPLETION' });
      const result = { status: body.status, recordIds: Array.isArray(body.recordIds) ? body.recordIds.filter((v: any) => /^rec[A-Za-z0-9]{14}$/.test(v)).slice(0, 20) : [], code: text(body.code).slice(0, 150) };
      if (receipt.data.status === 'claimed') {
        if (!await cas(store, receiptId, { ...receipt.data, status: body.status, completedAt: now(), result }, receipt)) return response(409, { error: 'COMPLETION_RACE' });
      } else if (receipt.data.status !== body.status) return response(409, { error: 'COMPLETION_STATE_CONFLICT' });
      if (slot?.data?.receiptId === receiptId && equal(slot.data.token, body.token)) {
        if (!await cas(store, laneKey, { state: 'idle', lastReceiptId: receiptId }, slot)) return response(503, { error: 'SLOT_RELEASE_UNCONFIRMED' });
      }
      log({ lane, receiptId, ...result });
      // Failure to dispatch the next receipt does not falsify this receipt's result.
      try { await dispatch(); } catch { log({ lane, status: 'queue_dispatch_failed' }); }
      return response(200, { acknowledged: true, status: body.status });
    }
    const apiKey = env('JOTFORM_API_KEY');
    if (!apiKey) return response(503, { error: 'INTAKE_NOT_CONFIGURED' });
    webhook();
    let form: FormData;
    try { form = await req.formData(); } catch { return response(400, { error: 'INVALID_FORM_DATA' }); }
    const submissionId = text(form.get('submissionID') ?? form.get('submission_id'));
    const formId = text(form.get('formID') ?? form.get('form_id'));
    const representation = lane === 'candidate' && formId === REPRESENTATION_FORM;
    const clientAgreement = lane === 'client' && formId === CLIENT_AGREEMENT_FORM;
    if (!/^\d{16,22}$/.test(submissionId) || (!representation && !clientAgreement && formId !== FORMS[lane])) return response(400, { error: 'INVALID_SOURCE_IDENTITY' });
    if (representation && env('JEF_REPRESENTATION_INTAKE_ENABLED') !== 'true') return response(503, { error: 'REPRESENTATION_NOT_ENABLED' });
    if (clientAgreement && env('JEF_CLIENT_AGREEMENT_INTAKE_ENABLED') !== 'true') return response(503, { error: 'CLIENT_AGREEMENT_NOT_ENABLED' });
    const provider = await deps.fetch(`https://api.jotform.com/submission/${submissionId}`, { headers: { APIKEY: apiKey }, signal: AbortSignal.timeout(15000) });
    if (!provider.ok) return response(provider.status === 404 ? 400 : 503, { error: 'PROVIDER_LOOKUP_FAILED' });
    const body = await provider.json();
    if (body.responseCode !== 200 || body.content?.id !== submissionId) return response(503, { error: 'PROVIDER_RESPONSE_INVALID' });
    if (String(body.content?.form_id) !== formId) return response(400, { error: 'PROVIDER_FORM_OR_STATUS_MISMATCH' });
    const envelope = normalizeSubmission(lane, body.content, now());
    const receiptPrefix = `receipt/${lane}/${submissionId}/`;
    receiptId = `${receiptPrefix}${envelope.version}`;
    let existing = await read(store, receiptId);
    // Migration compatibility: receipts created before semantic versioning hashed the
    // full snapshot, including mutable updatedAt. Reuse any equivalent legacy receipt
    // instead of manufacturing a new receipt/evidence on first post-patch replay.
    if (!existing) {
      const compatible = await equivalentReceipt(receiptPrefix, envelope.version);
      if (compatible) { receiptId = compatible.key; existing = compatible.value; }
    }
    if (!existing) {
      await cas(store, receiptId, { status: 'queued', envelope });
      existing = await read(store, receiptId);
    }
    if (!existing) throw new Error('RECEIPT_WRITE_UNCONFIRMED');
    if (['done', 'exception'].includes(existing.data.status)) return response(200, { received: true, status: existing.data.status, replay: true, sourceEventKey: envelope.sourceKey });
    if (existing.data.status === 'failed') {
      if (!await cas(store, receiptId, { ...existing.data, status: 'queued', token: null, consumerToken: null }, existing)) return response(503, { error: 'RETRY_RACE' });
    }
    return response(202, { received: true, status: await dispatch(receiptId), sourceEventKey: envelope.sourceKey });
  } catch (error) {
    log({ lane, receiptId, status: 'failed_or_uncertain', code: error instanceof Error ? error.name : 'ERROR' });
    return response(503, { error: 'INTAKE_FAILED_OR_UNCERTAIN' });
  }
}
