const fs = require('node:fs');
const path = require('node:path');
const { ROOT, runTemplate } = require('./gtm-harness');

const FIXTURE_DIR = path.join(__dirname, 'event-ingestion-contract-v1');
const SERVER = {
  origin: 'https://merchant.example',
  host: 'track.merchant.example',
  remote_addr: '203.0.113.24',
  user_agent: 'gtm-contract-fixture'
};

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function hostFromUrl(url) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch (error) {
    return null;
  }
}

function canonicalUser(raw) {
  const core = [
    'email', 'phone', 'first_name', 'last_name', 'full_name',
    'company', 'job_title', 'street', 'street2', 'city', 'state',
    'zip', 'country', 'gender', 'birth_date', 'external_id', 'lead_source',
    'ip_address', 'user_agent'
  ];
  const normalized = {};
  core.forEach(function (key) {
    const value = raw && raw[key] != null && raw[key] !== '' ? String(raw[key]).trim() : null;
    if (value === null) {
      normalized[key] = null;
    } else if (key === 'email' || key === 'first_name' || key === 'last_name' || key === 'full_name') {
      normalized[key] = value.toLowerCase();
    } else if (key === 'phone') {
      normalized[key] = value.replace(/\D+/g, '');
    } else {
      normalized[key] = value;
    }
  });
  normalized.custom_traits = [];
  return normalized;
}

function expectedCanonical(request) {
  const context = request.context || {};
  const page = context.page || {};
  const output = [];
  (request.events || []).forEach(function (event) {
    const canonicalContext = {
      stuid: null,
      session_id: null,
      session: null,
      page_title: page.page_title || null,
      referrer: null,
      ip_address: SERVER.remote_addr,
      user_agent: SERVER.user_agent,
      utm: {},
      tracking_ids: {},
      cookies: {},
      ingest_host: hostFromUrl(page.url)
    };
    if (page.url) {
      canonicalContext.page_url = page.url;
    }
    const canonical = {
      event_id: event.id,
      event_name: event.name,
      event_time: Math.floor(context.timestamp_ms / 1000),
      channel: 'webevents',
      action_source: request.action_source || 'browser',
      provider: request.provider || request.source_platform,
      property_id: 1,
      source: 'browser',
      source_platform: request.source_platform,
      context: canonicalContext,
      user: canonicalUser(context.user || {}),
      params: plain((event.data && event.data.params) || {})
    };
    if (event.data && event.data._delivery) {
      canonical._delivery = plain(event.data._delivery);
    }
    output.push(canonical);
  });
  return output;
}

function fixture(caseId, request) {
  const eventIds = request.events.map(function (event) {
    return event.id;
  });
  return {
    schema: 'event-ingestion-contract-v1',
    case: caseId,
    entrypoint: 'browser',
    submissions: 2,
    request: plain(request),
    server: SERVER,
    expected: {
      canonical: expectedCanonical(request),
      persistence: { rows: eventIds.length, event_ids: eventIds },
      forwarding: { calls: eventIds.length, event_ids: eventIds }
    },
    mask: []
  };
}

function buildFixtures() {
  const purchase = runTemplate({
    eventName: 'purchase',
    eventId: 'gtm_purchase_fixture_1',
    currency: 'BRL',
    value: '197.90',
    itemsTable: [
      { item_id: 'sku-1', item_name: 'Fixture Item', price: '197.90', quantity: '1' }
    ],
    paramTable1: [
      { userParameter: 'email', userParameterValue: 'buyer@example.com' },
      { userParameter: 'phone', userParameterValue: '+55 (11) 99999-0000' },
      { userParameter: 'first_name', userParameterValue: 'Ana' },
      { userParameter: 'last_name', userParameterValue: 'Silva' },
      { userParameter: 'date_of_birth', userParameterValue: '1990-01-02' },
      { userParameter: 'city', userParameterValue: 'Sao Paulo' },
      { userParameter: 'state', userParameterValue: 'SP' },
      { userParameter: 'zip', userParameterValue: '01000-000' },
      { userParameter: 'country', userParameterValue: 'BR' }
    ]
  }, {
    getUrl: function () { return 'https://merchant.example/checkout/thank-you'; },
    getTimestampMillis: function () { return 1700000000000; }
  }).supremeConfig.payload;

  const lead = runTemplate({
    eventName: 'lead',
    paramTable1: [
      { userParameter: 'email', userParameterValue: 'lead@example.com' }
    ]
  }, {
    getUrl: function () { return 'https://merchant.example/contact'; },
    getTimestampMillis: function () { return 1700000000006; },
    generateRandom: function () { return 444444444; }
  }).supremeConfig.payload;

  return {
    'gtm.purchase-provenance-identity.json': fixture('gtm.purchase-provenance-identity', purchase),
    'gtm.lead-generated-event-id.json': fixture('gtm.lead-generated-event-id', lead)
  };
}

function serialize(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

function main() {
  const fixtures = buildFixtures();
  const mode = process.argv[2] || '--print';
  if (mode === '--write') {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    Object.entries(fixtures).forEach(function ([name, value]) {
      fs.writeFileSync(path.join(FIXTURE_DIR, name), serialize(value), 'utf8');
    });
    return;
  }
  if (mode === '--check') {
    let failed = false;
    Object.entries(fixtures).forEach(function ([name, value]) {
      const file = path.join(FIXTURE_DIR, name);
      const expected = serialize(value);
      const actual = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
      if (actual !== expected) {
        failed = true;
        process.stderr.write('Fixture is stale: ' + path.relative(ROOT, file) + '\n');
      }
    });
    process.exitCode = failed ? 1 : 0;
    return;
  }
  process.stdout.write(serialize(fixtures));
}

module.exports = { buildFixtures, expectedCanonical };

if (require.main === module) {
  main();
}
