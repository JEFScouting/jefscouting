// Preparation for the existing Candidate Master, not a second intake or writer.
// Bind only to an inspected provider export. No production QIDs are invented here.
import { createHash } from 'node:crypto';

export const CANDIDATE_FORM_ID = '261480775333056';
export const PROFILE_CONTRACT = 'JEF-CANDIDATE-PROFILE-1';
// The audited Master has original elements through q60. Never rebind those IDs.
const reservedQid = qid => Number(qid) <= 60;
const option = (key, en, es) => ({ key, label: { en, es } });
const selected = key => ({ op: 'selected', field: 'roles', value: key });
const eq = (field, value) => ({ op: 'equals', field, value });
const all = (...rules) => ({ op: 'all', rules });
const any = (...rules) => ({ op: 'any', rules });
const experienceKeys = ['supported', 'independent', 'lead'];
export const EXPERIENCE = [
  option('starting', 'I want to start; I have not worked in this role yet', 'Me interesa empezar; todavía no trabajé en este rol'),
  option('supported', 'I have done this with support or supervision', 'Lo hice con apoyo o supervisión'),
  option('independent', 'I have performed this role independently', 'Lo desempeñé de forma independiente'),
  option('lead', 'I have also supervised or trained others in this role', 'También supervisé o capacité a otras personas en este rol'),
  option('discuss', 'I would prefer to discuss this with JEF', 'Prefiero explicarlo con JEF'),
];
const RECENCY = [
  option('last_6_months', 'Within the last 6 months', 'En los últimos 6 meses'),
  option('6_to_24_months', '6–24 months ago', 'Hace 6–24 meses'),
  option('over_24_months', 'More than 24 months ago', 'Hace más de 24 meses'),
  option('unknown', 'I do not remember / I would prefer to explain', 'No recuerdo / prefiero explicarlo'),
];
const DETAIL = [option('yes', 'Yes, add details now', 'Sí, agregar detalles ahora'), option('later', 'I will add details later', 'Completaré los detalles después')];
const task = (key, en, es) => option(key, en, es);
const T = {
  table_service: task('table_service', 'Table service', 'Servicio a la mesa'),
  plated: task('plated', 'Plated banquet service', 'Servicio emplatado de banquetes'),
  buffet: task('buffet', 'Buffet service', 'Servicio de buffet'),
  trays: task('trays', 'Tray service', 'Servicio con bandeja'),
  reservations: task('reservations', 'Reservations', 'Reservas'),
  seating: task('seating', 'Guest reception and seating', 'Recepción y ubicación de huéspedes'),
  clearing: task('clearing', 'Clearing and resetting tables', 'Retiro y montaje de mesas'),
  running: task('running', 'Food running and expo support', 'Entrega de platos y apoyo al pase'),
  bar_setup: task('bar_setup', 'Bar setup and closing', 'Apertura y cierre de barra'),
  cocktails: task('cocktails', 'Cocktail preparation', 'Preparación de cocktails'),
  beer_wine: task('beer_wine', 'Beer and wine service', 'Servicio de cerveza y vino'),
  restocking: task('restocking', 'Restocking and service support', 'Reposición y apoyo al servicio'),
  espresso: task('espresso', 'Espresso preparation', 'Preparación de espresso'),
  milk: task('milk', 'Milk steaming', 'Texturización de leche'),
  grinding: task('grinding', 'Grinder adjustment', 'Ajuste de molienda'),
  prep: task('prep', 'Ingredient preparation and mise en place', 'Preparación de ingredientes y mise en place'),
  hot: task('hot', 'Hot station', 'Estación caliente'),
  cold: task('cold', 'Cold station', 'Estación fría'),
  sushi: task('sushi', 'Sushi preparation', 'Preparación de sushi'),
  batch: task('batch', 'Batch cooking and banquet production', 'Producción de cocina para banquetes'),
  pastry: task('pastry', 'Pastry production', 'Producción de pastelería'),
  bakery: task('bakery', 'Bakery production', 'Panadería'),
  team: task('team', 'Team coordination and training', 'Coordinación y capacitación de equipo'),
  planning: task('planning', 'Production and service planning', 'Planificación de producción y servicio'),
  inventory: task('inventory', 'Ordering and inventory', 'Pedidos e inventario'),
  dishes: task('dishes', 'Dishwashing and sanitation', 'Lavado de vajilla e higiene'),
  kitchen_support: task('kitchen_support', 'Kitchen cleaning and utility support', 'Limpieza y apoyo de cocina'),
  check_in_out: task('check_in_out', 'Guest check-in and check-out', 'Check-in y check-out'),
  payments: task('payments', 'Payments and billing', 'Cobros y facturación'),
  audit: task('audit', 'Night audit and daily closing', 'Night audit y cierre diario'),
  requests: task('requests', 'Guest requests and assistance', 'Solicitudes y asistencia al huésped'),
  luggage: task('luggage', 'Luggage assistance', 'Asistencia con equipaje'),
  pool_beach: task('pool_beach', 'Pool or beach service', 'Servicio de piscina o playa'),
  event_setup: task('event_setup', 'Event setup and breakdown', 'Montaje y desmontaje de eventos'),
  brand: task('brand', 'Brand representation and guest engagement', 'Representación de marca y atención al público'),
  access: task('access', 'Access control', 'Control de acceso'),
  patrol: task('patrol', 'Patrols and incident reporting', 'Rondas y reporte de incidentes'),
};
const role = (key, family, en, es, tasks) => ({ key, family, label: { en, es }, tasks: tasks.map(k => T[k]) });
export const ROLES = [
  role('server', 'service', 'Server', 'Mesero/a', ['table_service', 'trays', 'beer_wine']),
  role('banquet_server', 'service', 'Banquet Server', 'Mesero/a de banquetes', ['plated', 'buffet', 'trays']),
  role('host', 'service', 'Host / Hostess', 'Host / Hostess', ['seating', 'reservations']),
  role('busser', 'service', 'Busser', 'Busser / ayudante de salón', ['clearing', 'restocking']),
  role('food_runner', 'service', 'Food Runner', 'Food Runner / corredor de platos', ['running', 'clearing']),
  role('bartender', 'bar_coffee', 'Bartender', 'Bartender', ['bar_setup', 'cocktails', 'beer_wine']),
  role('barback', 'bar_coffee', 'Barback', 'Barback / ayudante de barra', ['restocking', 'bar_setup', 'dishes']),
  role('barista', 'bar_coffee', 'Barista', 'Barista', ['espresso', 'milk', 'grinding']),
  role('prep_cook', 'culinary', 'Prep Cook', 'Cocinero/a de preparación', ['prep', 'cold']),
  role('line_cook', 'culinary', 'Line Cook', 'Cocinero/a de línea', ['hot', 'cold', 'sushi']),
  role('banquet_cook', 'culinary', 'Banquet Cook', 'Cocinero/a de banquetes', ['prep', 'batch']),
  role('pastry_bakery', 'culinary', 'Pastry / Bakery', 'Pastelería / panadería', ['pastry', 'bakery']),
  role('sous_chef', 'culinary', 'Sous Chef', 'Sous Chef', ['hot', 'planning', 'team']),
  role('executive_chef', 'culinary', 'Chef / Executive Chef', 'Chef / Chef ejecutivo', ['planning', 'inventory', 'team']),
  role('dishwasher', 'culinary', 'Dishwasher', 'Lavaplatos', ['dishes']),
  role('kitchen_support', 'culinary', 'Kitchen Support / Utility', 'Apoyo de cocina / utility', ['kitchen_support', 'restocking']),
  role('front_desk', 'hotel', 'Front Desk', 'Recepción / Front Desk', ['check_in_out', 'payments', 'requests']),
  role('reservations', 'hotel', 'Reservations', 'Reservas', ['reservations', 'requests']),
  role('night_audit', 'hotel', 'Night Audit', 'Auditoría nocturna / Night Audit', ['audit', 'payments', 'check_in_out']),
  role('concierge', 'hotel', 'Concierge / Guest Services', 'Concierge / atención al huésped', ['requests', 'reservations']),
  role('bellman', 'hotel', 'Bellman', 'Bellman / botones', ['luggage', 'requests']),
  role('pool_beach', 'hotel', 'Pool / Beach Attendant', 'Asistente de piscina / playa', ['pool_beach', 'requests']),
  role('hospitality_attendant', 'hotel', 'Hospitality Attendant', 'Asistente de hospitalidad', ['requests', 'restocking']),
  role('event_captain', 'events', 'Event Captain', 'Capitán/a de eventos', ['team', 'planning', 'event_setup']),
  role('manager_supervisor', 'events', 'Manager / Supervisor', 'Manager / Supervisor', ['team', 'planning', 'inventory']),
  role('event_production', 'events', 'Event Production Support', 'Apoyo de producción de eventos', ['event_setup', 'restocking']),
  role('brand_ambassador', 'events', 'Brand Ambassador', 'Embajador/a de marca', ['brand', 'requests']),
  role('security', 'security', 'Security', 'Seguridad', ['access', 'patrol']),
  role('other', 'other', 'Other — specify position', 'Otra — especificar posición', []),
];
const environments = (...labels) => labels.map(([key, en, es]) => option(key, en, es));
export const FAMILIES = [
  { key: 'service', label: { en: 'Service', es: 'Servicio' }, contexts: environments(['restaurant', 'Restaurant', 'Restaurante'], ['hotel', 'Hotel', 'Hotel'], ['banquet', 'Banquets / events', 'Banquetes / eventos']) },
  { key: 'bar_coffee', label: { en: 'Bar and coffee', es: 'Barra y café' }, contexts: environments(['restaurant', 'Restaurant / bar', 'Restaurante / bar'], ['hotel', 'Hotel', 'Hotel'], ['events', 'Events / catering', 'Eventos / catering'], ['coffee_shop', 'Coffee shop', 'Cafetería']) },
  { key: 'culinary', label: { en: 'Culinary', es: 'Cocina' }, contexts: environments(['restaurant', 'Restaurant', 'Restaurante'], ['hotel', 'Hotel', 'Hotel'], ['banquet', 'Banquets / catering', 'Banquetes / catering'], ['bakery', 'Pastry / bakery', 'Pastelería / panadería']) },
  { key: 'hotel', label: { en: 'Hotel and guest services', es: 'Hotel y huéspedes' }, contexts: environments(['hotel', 'Hotel', 'Hotel'], ['resort', 'Resort', 'Resort'], ['residential', 'Residential / condominium', 'Residencia / condominio'], ['other', 'Another operation', 'Otra operación']) },
  { key: 'events', label: { en: 'Leadership and events', es: 'Liderazgo y eventos' }, contexts: environments(['hospitality', 'Hospitality operation', 'Operación de hospitalidad'], ['events', 'Events', 'Eventos'], ['brand', 'Brand / promotional work', 'Marca / promociones']) },
  { key: 'security', label: { en: 'Security', es: 'Seguridad' }, contexts: environments(['hospitality', 'Hospitality', 'Hospitalidad'], ['events', 'Events', 'Eventos'], ['residential', 'Residential', 'Residencial'], ['other', 'Another setting', 'Otro entorno']) },
  { key: 'other', label: { en: 'Other positions', es: 'Otras posiciones' }, contexts: environments(['hospitality', 'Hospitality', 'Hospitalidad'], ['other', 'Another setting', 'Otro entorno']) },
];
const fieldName = key => 'jefProfile_' + key.replaceAll('.', '_');
const hasExperience = role => any(...experienceKeys.map(value => eq(`experience.${role.key}`, value)));
const familyExperience = family => any(...ROLES.filter(r => r.family === family.key).map(r => all(selected(r.key), hasExperience(r))));
const familyLabel = key => FAMILIES.find(f => f.key === key).label;
const roleOptions = ROLES.map(r => option(r.key, `${familyLabel(r.family).en} — ${r.label.en}`, `${familyLabel(r.family).es} — ${r.label.es}`));

export function candidateProfileDefinition() {
  const fields = [{ key: 'roles', name: fieldName('roles'), type: 'control_checkbox', label: { en: 'Which positions would you like to work in with JEF? Select all that apply, including roles you are starting in.', es: '¿En qué posiciones te gustaría trabajar con JEF? Marca todas las que correspondan, aunque estés empezando.' }, options: roleOptions, required: true }];
  fields.push({ key: 'other_title', name: fieldName('other_title'), type: 'control_textbox', label: { en: 'Which other position?', es: '¿Qué otra posición?' }, visibleWhen: selected('other'), requiredWhen: selected('other') });
  for (const r of ROLES) {
    fields.push({ key: `experience.${r.key}`, name: fieldName(`experience.${r.key}`), type: 'control_dropdown', label: { en: `What experience do you have as a ${r.label.en}?`, es: `¿Qué experiencia tenés como ${r.label.es}?` }, options: EXPERIENCE, visibleWhen: selected(r.key), requiredWhen: selected(r.key) });
  }
  for (const f of FAMILIES) {
    const show = all(familyExperience(f), eq(`detail.${f.key}`, 'yes'));
    fields.push({ key: `detail.${f.key}`, name: fieldName(`detail.${f.key}`), type: 'control_radio', label: { en: `${f.label.en}: would you like to add details now?`, es: `${f.label.es}: ¿querés agregar detalles ahora?` }, options: DETAIL, visibleWhen: familyExperience(f), required: false });
    fields.push({ key: `context.${f.key}`, name: fieldName(`context.${f.key}`), type: 'control_checkbox', label: { en: `${f.label.en}: in which settings have you worked?`, es: `${f.label.es}: ¿en qué entornos trabajaste?` }, options: f.contexts, visibleWhen: show, required: false, scope: 'family' });
    for (const r of ROLES.filter(r => r.family === f.key)) {
      const details = all(selected(r.key), hasExperience(r), eq(`detail.${r.family}`, 'yes'));
      if (r.tasks.length) fields.push({ key: `tasks.${r.key}`, name: fieldName(`tasks.${r.key}`), type: 'control_checkbox', label: { en: `${r.label.en}: which tasks have you actually performed?`, es: `${r.label.es}: ¿qué tareas realizaste?` }, options: r.tasks, visibleWhen: details, required: false });
      fields.push({ key: `recency.${r.key}`, name: fieldName(`recency.${r.key}`), type: 'control_dropdown', label: { en: `When did you last work as a ${r.label.en}?`, es: `¿Cuándo trabajaste por última vez como ${r.label.es}?` }, options: RECENCY, visibleWhen: details, required: false });
    }
    fields.push({ key: `notes.${f.key}`, name: fieldName(`notes.${f.key}`), type: 'control_textarea', label: f.key === 'security' ? { en: 'Optional: describe your security responsibilities and relevant credentials you wish to report.', es: 'Opcional: describí tus funciones de seguridad y acreditaciones pertinentes que quieras informar.' } : { en: 'Optional: add a recent example, system used or responsibility that helps explain your experience.', es: 'Opcional: agregá un ejemplo reciente, sistema usado o responsabilidad que ayude a explicar tu experiencia.' }, visibleWhen: show, required: false, scope: 'family' });
  }
  return { contract: PROFILE_CONTRACT, formId: CANDIDATE_FORM_ID, status: 'PREPARATION_ONLY', layout: { provider: 'Jotform', style: 'Classic', mobileColumns: 1 }, legacyQidsPreserved: ['23', '34'], fields };
}

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const questionList = questions => Array.isArray(questions) ? questions : Object.entries(questions || {}).map(([qid, q]) => ({ qid, ...q }));
const actualOptions = q => Array.isArray(q.options) ? q.options : typeof q.options === 'string' ? q.options.split('|') : [];

// All bindings come from the provider export, never a posted hidden field or label.
export function bindCandidateProfile(questions, formId) {
  if (formId !== CANDIDATE_FORM_ID) throw new Error('PROFILE_FORM_MISMATCH');
  const definition = candidateProfileDefinition(), source = questionList(questions), fields = {}, issues = [], used = new Set();
  for (const field of definition.fields) {
    const matches = source.filter(q => q.name === field.name);
    if (matches.length !== 1) { issues.push({ code: matches.length ? 'DUPLICATE_FIELD_NAME' : 'MISSING_FIELD', field: field.key }); continue; }
    const q = matches[0], qid = String(q.qid ?? q.id ?? '');
    if (!/^[1-9]\d{0,8}$/.test(qid) || reservedQid(qid) || used.has(qid)) { issues.push({ code: 'INVALID_OR_REUSED_QID', field: field.key }); continue; }
    if (q.type !== field.type) { issues.push({ code: 'FIELD_TYPE_MISMATCH', field: field.key }); continue; }
    const providerOptions = actualOptions(q);
    if (field.options && (providerOptions.length !== field.options.length || field.options.some(o => !providerOptions.some(v => Object.values(o.label).includes(v))))) { issues.push({ code: 'FIELD_OPTIONS_MISMATCH', field: field.key }); continue; }
    if (field.options && new Set(providerOptions).size !== providerOptions.length) { issues.push({ code: 'DUPLICATE_PROVIDER_OPTION', field: field.key }); continue; }
    used.add(qid); fields[field.key] = { qid, type: field.type };
  }
  const manifest = { contract: PROFILE_CONTRACT, formId, fields };
  return { status: issues.length ? 'HOLD' : 'BOUND_FOR_QA', manifest, bindingHash: hash(manifest), issues, releaseReady: false };
}

function validManifest(manifest) {
  if (manifest?.contract !== PROFILE_CONTRACT || manifest?.formId !== CANDIDATE_FORM_ID) return false;
  const definition = candidateProfileDefinition(), ids = new Set();
  if (!manifest.fields || Object.keys(manifest.fields).length !== definition.fields.length) return false;
  return definition.fields.every(f => {
    const b = manifest.fields[f.key];
    if (!b || !/^[1-9]\d{0,8}$/.test(b.qid) || reservedQid(b.qid) || b.type !== f.type || ids.has(b.qid)) return false;
    ids.add(b.qid); return true;
  });
}

// The envelope is the one fetched/claimed by the existing receipt executor.
// This reader does not send, dispatch, activate, or write any canonical state.
export function readCandidateProfile(envelope, manifest) {
  if (envelope?.protocol !== 'JEF-INTAKE-2' || envelope?.lane !== 'candidate' || envelope?.formId !== CANDIDATE_FORM_ID || envelope?.snapshot?.formId !== CANDIDATE_FORM_ID || envelope?.snapshot?.submissionId !== envelope?.submissionId) throw new Error('INVALID_PROFILE_SOURCE_CONTEXT');
  if (!/^\d{16,22}$/.test(envelope.submissionId || '') || !/^[a-f0-9]{64}$/.test(envelope.version || '') || !envelope.snapshot.answers || typeof envelope.snapshot.answers !== 'object' || Array.isArray(envelope.snapshot.answers)) throw new Error('INVALID_PROFILE_SOURCE_CONTEXT');
  if (!validManifest(manifest)) throw new Error('UNBOUND_PROFILE_CONTRACT');
  const definition = candidateProfileDefinition(), values = {}, issues = [];
  const fields = Object.fromEntries(definition.fields.map(f => [f.key, f]));
  const read = key => {
    const binding = manifest.fields[key], q = envelope.snapshot.answers[binding.qid];
    if (!q || !Object.hasOwn(q, 'value')) return undefined;
    if (q.type !== binding.type) { issues.push({ code: 'ANSWER_TYPE_MISMATCH', field: key, qid: binding.qid }); return undefined; }
    return q.value;
  };
  const parseChoice = (key, many = false) => {
    const value = read(key);
    if (value === undefined || value === null || value === '') return many ? [] : null;
    const incoming = Array.isArray(value) ? value : [value];
    if ((!many && incoming.length !== 1) || incoming.some(v => typeof v !== 'string')) { issues.push({ code: 'INVALID_ANSWER_SHAPE', field: key }); return many ? [] : null; }
    const parsed = [];
    for (const v of incoming) {
      const match = fields[key].options.find(o => Object.values(o.label).includes(v));
      if (!match) issues.push({ code: 'UNMAPPED_OPTION', field: key }); else if (!parsed.includes(match.key)) parsed.push(match.key);
    }
    return many ? parsed : parsed[0] || null;
  };
  const chosen = parseChoice('roles', true);
  if (!chosen.length) issues.push({ code: 'ROLE_SELECTION_MISSING', field: 'roles' });
  values.roles = chosen;
  for (const r of ROLES.filter(r => chosen.includes(r.key))) {
    values[`experience.${r.key}`] = parseChoice(`experience.${r.key}`);
    if (!values[`experience.${r.key}`]) issues.push({ code: 'ROLE_EXPERIENCE_UNKNOWN', field: `experience.${r.key}` });
  }
  const hasExperienceIn = family => ROLES.some(r => r.family === family && chosen.includes(r.key) && experienceKeys.includes(values[`experience.${r.key}`]));
  const families = [];
  for (const f of FAMILIES.filter(f => hasExperienceIn(f.key))) {
    values[`detail.${f.key}`] = parseChoice(`detail.${f.key}`);
    if (values[`detail.${f.key}`] !== 'yes') continue;
    const rawNotes = read(`notes.${f.key}`);
    if (rawNotes !== undefined && typeof rawNotes !== 'string') issues.push({ code: 'INVALID_ANSWER_SHAPE', field: `notes.${f.key}` });
    families.push({ familyKey: f.key, scope: 'family', contexts: parseChoice(`context.${f.key}`, true), notes: typeof rawNotes === 'string' ? rawNotes.trim() : '', qids: [manifest.fields[`context.${f.key}`].qid, manifest.fields[`notes.${f.key}`].qid] });
  }
  const roles = [];
  for (const r of ROLES.filter(r => chosen.includes(r.key))) {
    let title = r.label.en;
    if (r.key === 'other') {
      const v = read('other_title');
      if (typeof v === 'string' && v.trim()) title = v.trim(); else { title = ''; issues.push({ code: 'OTHER_TITLE_REQUIRED', field: 'other_title' }); }
    }
    const level = values[`experience.${r.key}`] || 'unknown';
    const detailActive = experienceKeys.includes(level) && values[`detail.${r.family}`] === 'yes';
    const tasks = detailActive && r.tasks.length ? parseChoice(`tasks.${r.key}`, true) : [];
    const recency = detailActive ? parseChoice(`recency.${r.key}`) : null;
    roles.push({ roleKey: r.key, title, familyKey: r.family, requested: true, experience: level, tasks, recency, authority: 'candidate-declared', experienceQid: manifest.fields[`experience.${r.key}`].qid });
  }
  const selectionComplete = chosen.length > 0 && !issues.some(x => x.field === 'roles' || x.code === 'OTHER_TITLE_REQUIRED');
  return { contract: PROFILE_CONTRACT, status: issues.length ? 'PARTIAL_REVIEW' : 'PARSED', source: { formId: envelope.formId, submissionId: envelope.submissionId, sourceKey: envelope.sourceKey, version: envelope.version, receivedAt: envelope.receivedAt, bindingHash: hash(manifest) }, selectionComplete, roles, families, issues };
}

// Reuse existing fields. These are reviewable proposals, NOT an alternate writer.
// "Secondary Role" is the existing role-item bucket, not a preference ranking.
export const PROFILE_ITEM_FIELDS = {
  tableId: 'tblmJvQTmHgosWQqt', name: 'fldOXNsr1TIxAL5dv', candidate: 'fldCJ25einiFQuTqx', itemType: 'fldm3emqD85QxAJxP', value: 'fld2dPj9XwzM1h1Yp', level: 'fldyHUfTvprvKVsvg', details: 'fld5xMiOM69GAingY', sourceType: 'fldNaq6XxrlHFf5wM', evidence: 'fldxtha27LTXmamNq', status: 'fldNVYH1WSlBVzsFZ',
};
export function candidateRoleProposals(profile, { candidateId, evidenceId }) {
  if (profile?.contract !== PROFILE_CONTRACT || !Array.isArray(profile.roles) || !/^rec[a-zA-Z0-9]{14}$/.test(candidateId || '') || !/^rec[a-zA-Z0-9]{14}$/.test(evidenceId || '')) throw new Error('UNRESOLVED_PROFILE_DESTINATION');
  const f = PROFILE_ITEM_FIELDS;
  return profile.roles.filter(r => r.title && r.experience !== 'unknown').map(r => ({
    tableId: f.tableId,
    reconciliationKey: `${candidateId}|declared-role|${r.roleKey}`,
    operation: 'RECONCILE_PROPOSAL',
    fields: {
      [f.name]: `Declared role — ${r.title}`,
      [f.candidate]: [{ id: candidateId }], [f.itemType]: { name: 'Secondary Role' },
      [f.value]: r.title, [f.level]: r.experience, [f.sourceType]: { name: 'Candidate-Entered' },
      [f.evidence]: [{ id: evidenceId }], [f.status]: { name: 'Proposed — Not Promoted' },
      [f.details]: 'JEF_CANDIDATE_ROLE_PROPOSAL_V1\n' + JSON.stringify({ ...r, source: profile.source }),
    },
  }));
}

// Evaluate the blueprint without a browser; field order never makes one role primary.
export function profileFieldState(field, values) {
  const evaluate = rule => {
    if (!rule) return true;
    if (rule.op === 'all') return rule.rules.every(evaluate);
    if (rule.op === 'any') return rule.rules.some(evaluate);
    if (rule.op === 'selected') return Array.isArray(values[rule.field]) && values[rule.field].includes(rule.value);
    if (rule.op === 'equals') return values[rule.field] === rule.value;
    throw new Error('UNKNOWN_PROFILE_CONDITION');
  };
  const visible = evaluate(field.visibleWhen);
  return { visible, required: visible && (field.required === true || Boolean(field.requiredWhen && evaluate(field.requiredWhen))) };
}
