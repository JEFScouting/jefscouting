import { getStore } from '@netlify/blobs';
import type { Context } from '@netlify/functions';
import { handleIntake } from './intake-transport.mts';
import type { Lane } from './intake-normalize.mts';
import legacyCandidate from './legacy-candidate.mts';
import legacyClient from './legacy-client.mts';

export async function intakeHandler(req: Request, context: Context, lane: Lane) {
  if (context.deploy.context !== 'production') return Response.json({ error: 'PRODUCTION_ONLY' }, { status: 403 });
  // Preserve the existing path until its native Airtable draft has been reviewed
  // and activated. Exactly one implementation handles each incoming submission.
  if (req.method === 'POST' && !(req.headers.get('content-type') || '').includes('application/json') && Netlify.env.get(`JEF_${lane.toUpperCase()}_INTAKE_V2_ENABLED`) !== 'true') {
    return (lane === 'candidate' ? legacyCandidate : legacyClient)(req);
  }
  return handleIntake(req, lane, {
    store: getStore({ name: 'jef-jotform-intake-receipts', consistency: 'strong' }),
    env: key => Netlify.env.get(key), fetch,
    now: () => new Date().toISOString(), log: entry => console.log(JSON.stringify(entry)),
  });
}
