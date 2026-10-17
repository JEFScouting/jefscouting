// Offline preparation only: this command has no HTTP client and performs no live edits.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { candidateProfileDefinition, bindCandidateProfile, readCandidateProfile, CANDIDATE_FORM_ID } from '../automation/intake/candidate-profile.mjs';

const args = process.argv.slice(2), flags = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--out', '--questions', '--envelope'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || flags[args[i]]) throw new Error('Usage: node scripts/prepare-candidate-profile.mjs --out DIR [--questions EXPORT.json] [--envelope CLAIMED-ENVELOPE.json]');
  flags[args[i]] = args[i + 1];
}
if (!flags['--out'] || (flags['--envelope'] && !flags['--questions'])) throw new Error('--out is required; --envelope also requires --questions');
const directory = resolve(flags['--out']);
const definition = candidateProfileDefinition();
let binding = null, profile = null;
if (flags['--questions']) {
  const data = JSON.parse(await readFile(flags['--questions'], 'utf8'));
  binding = bindCandidateProfile(data.questions ?? data.content ?? data, data.formId ?? CANDIDATE_FORM_ID);
  if (flags['--envelope']) {
    if (binding.status !== 'BOUND_FOR_QA') throw new Error('Cannot read profile: provider bindings are unresolved');
    profile = readCandidateProfile(JSON.parse(await readFile(flags['--envelope'], 'utf8')), binding.manifest);
  }
}
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'candidate-profile-definition.json'), JSON.stringify(definition, null, 2) + '\n');
if (binding) await writeFile(join(directory, 'candidate-profile-binding.json'), JSON.stringify(binding, null, 2) + '\n');
if (profile) await writeFile(join(directory, 'candidate-profile-readback.json'), JSON.stringify(profile, null, 2) + '\n');
console.log(JSON.stringify({ mode: 'OFFLINE_PREPARATION', roles: definition.fields[0].options.length, proposedElements: definition.fields.length, binding: binding?.status ?? 'UNBOUND', liveMutations: 0, output: directory }));
if (binding?.status === 'HOLD') process.exitCode = 2;
