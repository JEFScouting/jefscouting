'use strict';

// Temporary release diagnostics, not an intake writer or another public API.
// Credentials stay in the already authorized Netlify build environment.
// Only closed, non-personal result shapes reach the existing deploy summary.
const { createHash } = require('node:crypto');
const SITE = '0b736ac6-14f3-4766-9ed4-15561e64d17e';
const EXPIRES = Date.parse('2026-10-03T00:00:00Z');
const FORMS = { candidate: '261480775333056', client: '262081932367056' };

async function checkProvider({ env, fetchImpl, now }) {
  if (env.SITE_ID !== SITE || env.CONTEXT !== 'production' || now >= EXPIRES) return { mode: 'SKIPPED_OUTSIDE_BOUNDED_PRODUCTION_CHECK' };
  if (!env.JOTFORM_API_KEY) return { mode: 'READ_ONLY', error: 'PROVIDER_KEY_UNAVAILABLE' };
  const get = async path => {
    try {
      const r = await fetchImpl('https://api.jotform.com' + path, {
        method: 'GET', headers: { APIKEY: env.JOTFORM_API_KEY },
        redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) return { error: 'PROVIDER_HTTP_' + r.status };
      const p = await r.json();
      return p.responseCode === 200 ? { content: p.content } : { error: 'PROVIDER_RESPONSE_REJECTED' };
    } catch { return { error: 'PROVIDER_READ_FAILED' }; }
  };
  const report = { mode: 'READ_ONLY', observedAt: new Date(now).toISOString(), forms: {} };
  for (const [lane, formId] of Object.entries(FORMS)) {
    const [hooks, questions, submissions] = await Promise.all([
      get('/form/' + formId + '/webhooks'),
      get('/form/' + formId + '/questions'),
      get('/form/' + formId + '/submissions?limit=3&orderby=created_at'),
    ]);
    const expectedPath = '/api/' + lane + '-jotform-webhook';
    const hookReport = hooks.error ? { error: hooks.error } : {
      count: Object.keys(hooks.content || {}).length,
      destinations: Object.values(hooks.content || {}).map(value => {
        // Jotform documents id -> URL; unexpected shapes are not guessed.
        if (typeof value !== 'string') return { kind: 'UNEXPECTED_PROVIDER_SHAPE' };
        try {
          const u = new URL(value);
          const exact = u.protocol === 'https:' && u.hostname === 'jefscouting.com' && u.pathname === expectedPath && !u.search && !u.hash;
          return {
            kind: exact ? 'EXISTING_CANONICAL_ADAPTER' : u.hostname === 'hooks.airtable.com' ? 'DIRECT_AIRTABLE' : 'OTHER_DESTINATION',
            fingerprint: createHash('sha256').update(value).digest('hex'),
            hasQuery: !!u.search,
          };
        } catch { return { kind: 'INVALID_WEBHOOK_URL' }; }
      }),
    };
    const questionReport = questions.error ? { error: questions.error } : {
      count: Object.keys(questions.content || {}).length,
      fields: Object.entries(questions.content || {}).filter(([id]) => /^\d+$/.test(id)).map(([id, q]) => ({
        id, type: /^control_[a-z0-9_]+$/.test(q?.type || '') ? q.type : 'UNKNOWN',
      })),
    };
    const submissionReport = submissions.error ? { error: submissions.error } : !Array.isArray(submissions.content) ? { error: 'UNEXPECTED_SUBMISSION_SHAPE' } : {
      recent: submissions.content.map(s => ({
        id: typeof s.id === 'string' && /^\d{16,22}$/.test(s.id) ? s.id : null,
        createdAt: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s.created_at || '') ? s.created_at : null,
        status: ['ACTIVE', 'DELETED'].includes(s.status) ? s.status : 'UNKNOWN',
      })),
    };
    let adapter = { error: 'ADMIN_SECRET_UNAVAILABLE' };
    if (env.JOTFORM_ADMIN_SECRET) {
      try {
        const r = await fetchImpl('https://jefscouting.com' + expectedPath, {
          method: 'GET', headers: { authorization: 'Bearer ' + env.JOTFORM_ADMIN_SECRET },
          redirect: 'error', signal: AbortSignal.timeout(15000),
        });
        adapter = { httpStatus: r.status };
        if (r.ok) {
          const p = await r.json();
          adapter.state = ['idle', 'active'].includes(p.state) ? p.state : 'UNKNOWN';
          adapter.counts = Object.fromEntries(['queued', 'dispatching', 'claimed', 'done', 'exception', 'failed'].map(k => [k, Number.isSafeInteger(p.counts?.[k]) ? p.counts[k] : null]));
        }
      } catch { adapter = { error: 'ADAPTER_STATUS_READ_FAILED' }; }
    }
    report.forms[lane] = { formId, webhooks: hookReport, questions: questionReport, submissions: submissionReport, adapter };
  }
  return report;
}

module.exports = { checkProvider };
