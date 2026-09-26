const fs = require('node:fs');
const path = require('node:path');
const { ROOT, runTemplate } = require('./gtm-harness');

const FIXTURE_DIR = path.join(__dirname, 'lead-contract-v1');
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'gtm.lead.json');

function buildPayload() {
  return runTemplate({
    eventName: 'lead',
    eventId: 'lead-contract-v1-gtm',
    paramTable1: [
      { userParameter: 'email', userParameterValue: 'Maria.Silva@Example.com' },
      { userParameter: 'phone', userParameterValue: '+55 (11) 98765-4321' },
      { userParameter: 'first_name', userParameterValue: 'Maria' },
      { userParameter: 'last_name', userParameterValue: 'Silva' },
      { userParameter: 'company', userParameterValue: 'Acme Ltda' },
      { userParameter: 'job_title', userParameterValue: 'Diretora' }
    ],
    leadStatus: 'qualified',
    leadSource: 'landing-page',
    sourceLeadId: 'form-2026-0001',
    leadValue: '150.5',
    leadCurrency: 'BRL',
    customFieldsTable: [
      { fieldKey: 'plan_interest', fieldValue: 'pro' },
      { fieldKey: 'employees', fieldValue: '12' },
      { fieldKey: 'newsletter', fieldValue: 'true' },
      { fieldKey: 'notes', fieldValue: 'Olá, "quero" demo amanhã' }
    ]
  }, {
    getUrl: function () { return 'https://example.com/contato'; },
    getTimestampMillis: function () { return 1790000000000; }
  }).supremeConfig.payload;
}

function serialize(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

function main() {
  const payload = buildPayload();
  const expected = serialize(payload);
  const mode = process.argv[2] || '--print';

  if (mode === '--write') {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    fs.writeFileSync(FIXTURE_FILE, expected, 'utf8');
    return;
  }

  if (mode === '--check') {
    const actual = fs.existsSync(FIXTURE_FILE)
      ? fs.readFileSync(FIXTURE_FILE, 'utf8').replace(/\r\n/g, '\n')
      : '';
    if (actual !== expected) {
      process.stderr.write('Fixture is stale: ' + path.relative(ROOT, FIXTURE_FILE) + '\n');
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
    return;
  }

  process.stdout.write(expected);
}

module.exports = { buildPayload };

if (require.main === module) {
  main();
}
