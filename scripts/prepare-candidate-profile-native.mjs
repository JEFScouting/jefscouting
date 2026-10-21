// Offline, guarded adaptation of an observed native script. Never publishes.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateProfileBindingHash } from '../automation/intake/candidate-profile.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const entry = '  const e = envelope;';
const candidateEnd = "    await verify('evidence',evidenceId,{'Candidates':[{id:candidate.id}]});\n    return finish(issues.length?'exception':'done');";
const marker = '// JEF_CANDIDATE_PROFILE_QA_PATCH_V1';
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('NATIVE_PATCH_ANCHOR_CHANGED');
  return source.replace(before, after);
}

export async function buildCandidateProfileNativePatch(nativeSource, expectedNativeSha, release) {
  if (!/^[a-f0-9]{64}$/.test(expectedNativeSha || '') || sha(nativeSource) !== expectedNativeSha) throw new Error('NATIVE_SOURCE_HASH_MISMATCH');
  if (nativeSource.includes(marker)) throw new Error('NATIVE_ALREADY_PATCHED');
  if (!release || !/^v?\d+\.\d+$/.test(release.formVersion || '') || release.formVersion === '1.0' || release.bindingHash !== candidateProfileBindingHash(release.manifest) || release.roleItemType !== 'Secondary Role') throw new Error('UNBOUND_NATIVE_PROFILE_RELEASE');
  const root = new URL('../automation/intake/', import.meta.url);
  const profile = await readFile(new URL('candidate-profile.mjs', root), 'utf8');
  const executor = await readFile(new URL('candidate-profile-executor.mjs', root), 'utf8');
  const portableProfile = replaceOnce(profile, "import { createHash } from 'node:crypto';", '')
    .replace(/^export /gm, '');
  // Airtable's script runtime has no Node crypto import. Only this exact,
  // preverified embedded manifest can be hashed at runtime; all other input holds.
  const portableHash = "const hash = value => { if (JSON.stringify(value) !== JSON.stringify(jefCandidateProfileRelease.manifest)) throw new Error('UNBOUND_PROFILE_CONTRACT'); return jefCandidateProfileRelease.bindingHash; };";
  const bundledProfile = replaceOnce(portableProfile, "const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');", portableHash);
  const portableExecutor = executor.replace(/^import .+;\n/gm, '').replace(/^export /gm, '');
  let adapted = replaceOnce(nativeSource, entry, "  const jefProfileContext = jefCandidateProfile.prepareCandidateProfileEnvelope(envelope, jefCandidateProfileRelease);\n  const e = jefProfileContext.envelope;");
  adapted = replaceOnce(adapted, candidateEnd, "    await verify('evidence',evidenceId,{'Candidates':[{id:candidate.id}]});\n    if (jefProfileContext.profile) {\n      const profileResult = await jefCandidateProfile.reconcileCandidateProfile(jefProfileContext.profile, base, {candidateId:candidate.id,evidenceId});\n      issues.push(...profileResult.issues);\n      recordIds.push(...profileResult.recordIds);\n    }\n    return finish(issues.length?'exception':'done');");
  const script = `${marker}\n// QA artifact only. Independent review and paired form/transport cutover required.\n// Native baseline SHA256: ${expectedNativeSha}\nconst jefCandidateProfileRelease = ${JSON.stringify(release)};\nconst jefCandidateProfile = (() => {\n${bundledProfile}\n${portableExecutor}\nreturn {prepareCandidateProfileEnvelope,reconcileCandidateProfile};\n})();\n${adapted}`;
  // Parse the complete async native program without executing any provider call.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  new AsyncFunction('input', 'base', 'fetch', 'output', script);
  return { script, report: { mode: 'OFFLINE_NATIVE_QA_PATCH', releaseReady: false, liveMutations: 0,
    nativeBeforeSha256: expectedNativeSha, nativeAfterSha256: sha(script), bindingHash: release.bindingHash,
    formVersion: release.formVersion, preservedNativeSource: true, replacedAnchors: 2,
    requires: ['real-provider-bindings', 'private-form-conditions-qa', 'PR38-occurrence-admission', 'PR39-provider-time', 'matching-consumption-readback', 'independent-review', 'paired-release-approval'],
  } };
}

async function main() {
  const args = process.argv.slice(2), flags = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--out', '--native-script', '--expected-native-sha', '--release'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || flags[args[i]]) throw new Error('Expected --out DIR --native-script OBSERVED.js --expected-native-sha SHA256 --release REVIEWED.json');
    flags[args[i]] = args[i + 1];
  }
  if (Object.keys(flags).length !== 4) throw new Error('All four flags are required; no native output is emitted while unbound');
  const source = await readFile(resolve(flags['--native-script']), 'utf8');
  const release = JSON.parse(await readFile(resolve(flags['--release']), 'utf8'));
  const result = await buildCandidateProfileNativePatch(source, flags['--expected-native-sha'], release);
  const out = resolve(flags['--out']);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'candidate-profile-native-QA.js'), result.script);
  await writeFile(join(out, 'candidate-profile-native-patch.json'), JSON.stringify(result.report, null, 2) + '\n');
  console.log(JSON.stringify(result.report));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
