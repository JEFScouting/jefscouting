import test from 'node:test';
import assert from 'node:assert/strict';
import { handleIntake } from '../../netlify/functions/_shared/intake-transport.mts';
import { digest, normalizeSubmission } from '../../netlify/functions/_shared/intake-normalize.mts';
import { reconcile } from '../../automation/intake/reconcile.mjs';
import { FakeStore, FakeBase, source } from './harness.mjs';

function setup(lane = 'candidate') {
  const store = new FakeStore(), records = new FakeBase(), sent = [];
  let provider = source(lane), clock = Date.parse('2026-10-06T10:00:00Z');
  const config = {
    JOTFORM_API_KEY: 'test-provider-key', JOTFORM_ADMIN_SECRET: 'test-admin-key',
    [`JEF_${lane.toUpperCase()}_INTAKE_V2_ENABLED`]: 'true',
    [`AIRTABLE_${lane.toUpperCase()}_JOTFORM_WEBHOOK_URL`]: `https://hooks.airtable.com/workflows/v1/genericWebhook/appveHEw1HrXr8nD1/test/${lane}`,
  };
  const deps = {
    store, env: key => config[key], now: () => new Date(clock++).toISOString(), log: () => {},
    fetch: async (url, options) => {
      if (String(url).startsWith('https://api.jotform.com/submission/')) return Response.json({ responseCode: 200, content: provider });
      sent.push(JSON.parse(options.body));
      return Response.json({ success: true });
    },
  };
  const deliver = () => {
    const body = new FormData();
    body.set('submissionID', provider.id); body.set('formID', provider.form_id);
    return handleIntake(new Request(`https://jefscouting.com/api/${lane}-jotform-webhook`, { method: 'POST', body }), lane, deps);
  };
  const control = (action, extra = {}, admin = false) => handleIntake(new Request(`https://jefscouting.com/api/${lane}-jotform-webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(admin ? { authorization: 'Bearer test-admin-key' } : {}) },
    body: JSON.stringify({ ...sent.at(-1), action, ...extra }),
  }), lane, deps);
  const consume = async () => {
    const dispatch = sent.at(-1);
    const response = await control('claim', dispatch);
    assert.equal(response.status, 200);
    const claim = await response.json();
    assert.equal(claim.skip, false);
    const result = await reconcile(claim.envelope, records);
    assert.equal(result.status, 'done');
    assert.equal((await control('complete', { ...dispatch, consumerToken: claim.consumerToken, ...result })).status, 200);
    return claim.envelope;
  };
  const legacy = async (submission, time, status = 'queued') => {
    const envelope = normalizeSubmission(lane, submission, time);
    envelope.version = digest(envelope.snapshot);
    const key = `receipt/${lane}/${submission.id}/${envelope.version}`;
    await store.setJSON(key, { status, envelope }, { onlyIfNew: true });
    return key;
  };
  return { lane, store, records, sent, config, deps, deliver, control, consume, legacy, setProvider: value => { provider = value; } };
}

const keys = x => [...x.store.entries.keys()].filter(key => key.startsWith(`receipt/${x.lane}/`));
const at = second => `2026-10-06T09:00:${String(second).padStart(2, '0')}.000Z`;
const metadata = (submission, value) => ({ ...structuredClone(submission), updated_at: value });

for (const lane of ['candidate', 'client']) test(`${lane} A→B→A→A reconciles the return once and then replays`, async () => {
  const x = setup(lane), a = source(lane), b = structuredClone(a);
  if (lane === 'candidate') b.answers[34].answer = 'Server';
  else b.answers[8].answer.city = 'Fort Lauderdale';
  for (const state of [a, b, a]) {
    x.setProvider(state);
    assert.equal((await x.deliver()).status, 202);
    await x.consume();
  }
  assert.equal(new Set(x.sent.map(item => item.receiptId)).size, 3);
  assert.equal(x.records.data.evidence.size, 3);
  assert.equal(x.records.data[lane === 'candidate' ? 'candidates' : 'clients'].size, 1);
  if (lane === 'candidate') assert.equal([...x.records.data.candidates.values()][0]['Target Role'], 'Barista');
  else {
    assert.equal(x.records.data.intake.size, 1);
    assert.equal([...x.records.data.intake.values()][0]['Requested Location'], 'Miami Beach, FL');
  }
  const replay = await x.deliver();
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replay, true);
  assert.equal(x.sent.length, 3);
});

test('equivalent queued legacy receipts execute once and the old key stays inert under retry', async () => {
  const x = setup(), a = source();
  const first = await x.legacy(metadata(a, 'old-1'), at(1));
  const duplicate = await x.legacy(metadata(a, 'old-2'), at(2));
  x.setProvider(metadata(a, 'new-metadata'));
  assert.equal((await x.deliver()).status, 202);
  await x.consume();
  assert.equal(x.sent.length, 1);
  assert.equal(x.records.data.evidence.size, 1);
  assert.equal(x.store.entries.get(first).data.status, 'done');
  const retry = await x.control('retry', { receiptId: duplicate }, true);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).replay, true);
  assert.equal(x.sent.length, 1);
});

test('completion alone neutralizes another source’s equivalent legacy queue', async () => {
  const x = setup();
  await x.deliver();
  const other = source('candidate', '9000000000000000002', { 3: { first: '[JEF INTAKE QA] Sam', last: 'Taylor' }, 5: 'qa.sam@example.invalid', 4: { full: '2025550102' } });
  await x.legacy(metadata(other, 'old-1'), at(1));
  await x.legacy(metadata(other, 'old-2'), at(2));
  await x.consume();
  assert.equal(x.sent.length, 2);
  await x.consume();
  assert.equal(x.sent.length, 2);
  assert.equal(x.records.data.evidence.size, 2);
});

test('legacy completed receipt suppresses its consecutive queued equivalents without creating new evidence', async () => {
  const x = setup(), a = source();
  const done = await x.legacy(metadata(a, 'old-1'), at(1), 'done');
  const duplicate = await x.legacy(metadata(a, 'old-2'), at(2));
  const replay = await x.deliver();
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).replay, true);
  assert.equal((await x.control('retry', { receiptId: duplicate }, true)).status, 200);
  assert.equal(x.sent.length, 0);
  assert.equal(x.store.entries.get(done).data.status, 'done');
  assert.equal(x.records.data.evidence.size, 0);
});

test('legacy queued A→B→A preserves every real transition', async () => {
  const x = setup(), a = source(), b = structuredClone(a);
  b.answers[34].answer = 'Server';
  const first = await x.legacy(metadata(a, 'old-1'), at(1));
  const middle = await x.legacy(metadata(b, 'old-2'), at(2));
  const last = await x.legacy(metadata(a, 'old-3'), at(3));
  assert.equal((await x.deliver()).status, 202);
  for (let i = 0; i < 3; i++) await x.consume();
  assert.deepEqual(x.sent.map(item => item.receiptId), [first, middle, last]);
  assert.equal(x.records.data.evidence.size, 3);
  assert.equal([...x.records.data.candidates.values()][0]['Target Role'], 'Barista');
  assert.equal((await x.deliver()).status, 200);
});

for (const status of ['claimed', 'dispatching']) test(`${status} legacy survivor keeps its immutable envelope and fencing tokens`, async () => {
  const x = setup(), a = source();
  const active = await x.legacy(metadata(a, 'old-1'), at(1), status);
  const duplicate = await x.legacy(metadata(a, 'old-2'), at(2));
  const stored = x.store.entries.get(active);
  stored.data.token = 'legacy-dispatch-token'; stored.data.consumerToken = 'legacy-consumer-token';
  const envelope = structuredClone(stored.data.envelope);
  await x.store.setJSON('lane/candidate', { state: 'active', receiptId: active, token: stored.data.token }, { onlyIfNew: true });
  assert.equal((await x.deliver()).status, 202);
  assert.equal(x.sent.length, status === 'claimed' ? 0 : 1);
  const preserved = x.store.entries.get(active).data;
  assert.deepEqual(preserved.envelope, envelope);
  assert.equal(preserved.token, 'legacy-dispatch-token');
  assert.equal(preserved.consumerToken, 'legacy-consumer-token');
  assert.equal(preserved.status, status);
  assert.equal(x.store.entries.get(duplicate).data.status, 'superseded');
  if (status === 'claimed') assert.equal((await x.control('retry', { receiptId: active }, true)).status, 409);
  else { assert.equal(x.sent[0].token, 'legacy-dispatch-token'); await x.consume(); assert.equal(x.sent.length, 1); }
});

test('a durable admission recovers a missing receipt before advancing again', async () => {
  const x = setup(), a = source(), original = x.store.setJSON.bind(x.store);
  let failed = false;
  x.store.setJSON = async (key, data, options) => {
    if (!failed && key.startsWith('receipt/')) { failed = true; throw new Error('simulated receipt write failure'); }
    return original(key, data, options);
  };
  assert.equal((await x.deliver()).status, 503);
  assert.equal(x.sent.length, 0);
  assert.equal(keys(x).length, 0);
  const b = structuredClone(a); b.answers[34].answer = 'Server'; x.setProvider(b);
  assert.equal((await x.deliver()).status, 202);
  assert.equal(keys(x).length, 2);
  await x.consume(); await x.consume();
  assert.equal(x.records.data.evidence.size, 2);
  assert.equal([...x.records.data.candidates.values()][0]['Target Role'], 'Server');
});

test('simultaneous reversion deliveries admit one new occurrence and one writer', async () => {
  const x = setup(), a = source(), b = structuredClone(a); b.answers[34].answer = 'Server';
  await x.deliver(); await x.consume(); x.setProvider(b); await x.deliver(); await x.consume();
  x.setProvider(a);
  const deliveries = await Promise.all([x.deliver(), x.deliver()]);
  assert.ok(deliveries.every(item => item.status === 202));
  assert.equal(keys(x).length, 3);
  const claims = await Promise.all([x.control('claim'), x.control('claim')]);
  assert.equal(claims.filter(item => item.status === 200).length, 1);
  assert.equal(claims.filter(item => item.status === 409).length, 1);
});

test('tied legacy states hold without dispatching or guessing their order', async () => {
  const x = setup(), a = source(), b = structuredClone(a); b.answers[34].answer = 'Server';
  const first = await x.legacy(metadata(a, 'old-1'), at(1));
  const second = await x.legacy(metadata(b, 'old-2'), at(1));
  const before = structuredClone([...x.store.entries]);
  assert.equal((await x.deliver()).status, 503);
  assert.equal(x.sent.length, 0);
  assert.deepEqual([...x.store.entries], before);
  assert.deepEqual(keys(x), [first, second]);
});

test('new admissions sharing a clock tick still read back the latest managed fields', async () => {
  const x = setup(), a = source(), b = structuredClone(a); b.answers[34].answer = 'Server';
  x.deps.now = () => '2026-10-06T10:00:00.000Z';
  for (const state of [a, b, a]) { x.setProvider(state); assert.equal((await x.deliver()).status, 202); await x.consume(); }
  assert.equal(x.records.data.evidence.size, 3);
  assert.equal([...x.records.data.candidates.values()][0]['Target Role'], 'Barista');
  const receipts = keys(x).map(key => x.store.entries.get(key).data);
  assert.ok(receipts.every(receipt => receipt.observedAt === '2026-10-06T10:00:00.000Z'));
  assert.deepEqual(receipts.map(receipt => receipt.envelope.receivedAt), ['2026-10-06T10:00:00.000Z', '2026-10-06T10:00:00.001Z', '2026-10-06T10:00:00.002Z']);
});

test('a lost coalescing CAS holds before any duplicate becomes eligible', async () => {
  const x = setup(), a = source(), original = x.store.setJSON.bind(x.store);
  await x.legacy(metadata(a, 'old-1'), at(1));
  const duplicate = await x.legacy(metadata(a, 'old-2'), at(2));
  x.store.setJSON = async (key, data, options) => key === duplicate && data.status === 'superseded' ? { modified: false } : original(key, data, options);
  assert.equal((await x.deliver()).status, 503);
  assert.equal(x.sent.length, 0);
  x.store.setJSON = original;
  assert.equal((await x.deliver()).status, 202);
  await x.consume();
  assert.equal(x.sent.length, 1);
});

test('competing different-content admissions hold the loser without creating a queued orphan', { timeout: 2000 }, async () => {
  const x = setup(), a = source(), b = structuredClone(a), c = structuredClone(a);
  b.answers[34].answer = 'Server'; c.answers[34].answer = 'Cook';
  await x.deliver(); await x.consume();
  const original = x.store.setJSON.bind(x.store);
  let waiting, release;
  const held = new Promise(resolve => { waiting = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  x.store.setJSON = async (key, data, options) => {
    if (key.startsWith('head/') && data.envelope.candidate.targetRole === 'Server') { waiting(); await resume; }
    return original(key, data, options);
  };
  x.setProvider(b); const first = x.deliver(); await held;
  x.setProvider(c); assert.equal((await x.deliver()).status, 202);
  release(); assert.equal((await first).status, 503);
  assert.equal(keys(x).length, 2);
  await x.consume();
  assert.equal([...x.records.data.candidates.values()][0]['Target Role'], 'Cook');
});

test('a failed older occurrence cannot overwrite a later completed occurrence on retry', async () => {
  const x = setup(), a = source(), b = structuredClone(a); b.answers[34].answer = 'Server';
  await x.deliver(); const old = x.sent[0];
  const claim = await (await x.control('claim')).json();
  assert.equal((await x.control('complete', { consumerToken: claim.consumerToken, status: 'failed' })).status, 200);
  x.setProvider(b); await x.deliver(); await x.consume();
  assert.equal((await x.control('retry', { receiptId: old.receiptId }, true)).status, 409);
  assert.equal(x.sent.length, 2);
  assert.equal([...x.records.data.candidates.values()][0]['Target Role'], 'Server');
});

test('legacy failed receipt retains partial Evidence identity instead of selecting its queued equivalent', async () => {
  const x = setup(), a = source();
  const failed = await x.legacy(metadata(a, 'old-1'), at(1), 'failed');
  const duplicate = await x.legacy(metadata(a, 'old-2'), at(2));
  const envelope = x.store.entries.get(failed).data.envelope;
  x.records.failNext = 'candidates:create';
  await assert.rejects(() => reconcile(envelope, x.records));
  assert.equal(x.records.data.evidence.size, 1);
  assert.equal((await x.deliver()).status, 202);
  assert.equal(x.sent[0].receiptId, failed);
  await x.consume();
  assert.equal(x.records.data.evidence.size, 1);
  assert.equal(x.store.entries.get(duplicate).data.status, 'superseded');
});

test('uncertain failed legacy duplicates hold before changing any receipt', async () => {
  const x = setup(), a = source();
  await x.legacy(metadata(a, 'old-1'), at(1), 'failed');
  await x.legacy(metadata(a, 'old-2'), at(2), 'failed');
  await x.legacy(metadata(a, 'old-3'), at(3));
  const before = structuredClone([...x.store.entries]);
  assert.equal((await x.deliver()).status, 503);
  assert.equal(x.sent.length, 0);
  assert.deepEqual([...x.store.entries], before);
});

test('retry racing a later completed occurrence holds again at dispatch', { timeout: 2000 }, async () => {
  const x = setup(), a = source(), b = structuredClone(a); b.answers[34].answer = 'Server';
  await x.deliver(); const old = x.sent[0];
  const claim = await (await x.control('claim')).json();
  await x.control('complete', { consumerToken: claim.consumerToken, status: 'failed' });
  const original = x.store.setJSON.bind(x.store);
  let waiting, release;
  const held = new Promise(resolve => { waiting = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  x.store.setJSON = async (key, data, options) => {
    if (key === old.receiptId && data.status === 'queued') { waiting(); await resume; }
    return original(key, data, options);
  };
  const retry = x.control('retry', { receiptId: old.receiptId }, true); await held;
  x.setProvider(b); await x.deliver(); await x.consume();
  release(); assert.equal((await retry).status, 503);
  assert.equal(x.sent.length, 2);
  assert.equal([...x.records.data.candidates.values()][0]['Target Role'], 'Server');
  assert.equal((await x.deliver()).status, 200);
});
