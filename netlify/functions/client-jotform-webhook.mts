import type { Context, Config } from '@netlify/functions';
import { intakeHandler } from './_shared/intake-handler.mts';
export default (req: Request, context: Context) => intakeHandler(req, context, 'client');
export const config: Config = { path: '/api/client-jotform-webhook' };
