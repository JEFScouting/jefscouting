import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../',import.meta.url);
const schema = (await readFile(new URL('automation/intake/schema.mjs',root),'utf8')).replace('export const schema','const schema');
const core = (await readFile(new URL('automation/intake/reconcile.mjs',root),'utf8')).replace("import { schema } from './schema.mjs';",'').replace('export async function reconcile','async function reconcile');
const operations = (await readFile(new URL('automation/intake/operations-schema.mjs',root),'utf8')).replace('export const operationsSchema','const operationsSchema');
async function bundle(file,bindings,exports) {
 const body=(await readFile(new URL('automation/intake/'+file,root),'utf8')).replace(/^import .*;\n/gm,'').replace(/export (async )?function /g,(_,asyncPart)=>(asyncPart||'')+'function ');
 return `const {${exports.join(',')}}=(()=>{${bindings}\n${body}\nreturn {${exports.join(',')}};})();`;
}
const guards=await bundle('handoff-guards.mjs','',['coverageFinanceHandoff']);
const slots=await bundle('coverage-slots.mjs','',['fillMissingStaffingSlots']);
const finance=await bundle('finance-drafts.mjs','',['prepareFinanceDrafts']);
const handoffs=await bundle('handoff-runner.mjs','',['runIntakeHandoffs']);
const clientOperations=[operations,'const intakeSchema=schema;',guards,slots,finance,handoffs].join('\n');
await mkdir(new URL('automation/intake/generated/',root),{recursive:true});
for(const lane of ['candidate','client']) {
  const runner = `\n// Inputs: receiptId and token, each mapped from the existing webhook body.\nconst cfg=input.config();\nconst lane=${JSON.stringify(lane)};\nconst endpoint='https://jefscouting.com/api/'+lane+'-jotform-webhook';\nasync function call(action,extra={}) {\n const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,receiptId:cfg.receiptId,token:cfg.token,...extra})});\n if(!r.ok) throw new Error('INTAKE_PROTOCOL_'+r.status);\n return r.json();\n}\nconst claim=await call('claim');\nif(claim.skip){ output.set('status','REPLAY_NO_WRITE'); } else {\n if(claim.envelope.lane!==lane) throw new Error('LANE_MISMATCH');\n let result;\n try { result=await reconcile(claim.envelope,base);${lane==='client'?`\n const handoff=await runIntakeHandoffs(claim.envelope,result,base,async()=>{const proof=await call('assertClaim',{consumerToken:claim.consumerToken});return proof.held===true;});\n output.set('handoffReadback',JSON.stringify(handoff));\n`:''} } catch(error) {\n  await call('complete',{consumerToken:claim.consumerToken,status:'failed',code:'AIRTABLE_RECONCILIATION_FAILED'});\n  throw new Error('AIRTABLE_RECONCILIATION_FAILED');\n }\n await call('complete',{consumerToken:claim.consumerToken,...result});\n output.set('status',result.status);\n output.set('recordIds',result.recordIds.join(','));\n}\n`;
  await writeFile(new URL(`automation/intake/generated/${lane}.js`,root),schema+'\n'+core+(lane==='client'?'\n'+clientOperations:'')+runner);
}
