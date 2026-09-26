const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { templateParameters, webPermissions, runTemplate } = require('./gtm-harness');

const CANONICAL_GTM_LEAD_JSON = '{"action_source":"browser","context":{"page":{"url":"https://example.com/contato"},"timestamp_ms":1790000000000,"user":{"company":"Acme Ltda","email":"Maria.Silva@Example.com","first_name":"Maria","job_title":"Diretora","last_name":"Silva","phone":"+55 (11) 98765-4321"}},"events":[{"data":{"_delivery":{"mode":"supreme_send","source":"gtm_event_tag"},"params":{"currency":"BRL","lead":{"custom_fields":{"employees":12,"newsletter":true,"notes":"Olá, \\"quero\\" demo amanhã","plan_interest":"pro"},"source":"landing-page","source_lead_id":"form-2026-0001","status":"qualified"},"value":150.5}},"id":"lead-contract-v1-gtm","name":"lead"}],"provider":"gtm","source_platform":"gtm"}';
const CANONICAL_GTM_LEAD_SHA256 = '8b3caa6eece7c2dda62dddd841f80f3308365cae996e9eb8db6ad13a6d5992b9';

function canon(value) {
  if (Array.isArray(value)) return value.map(canon);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).sort().reduce(function (acc, key) {
      acc[key] = canon(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canon(value));
}

function validLeadInput(overrides) {
  return Object.assign({
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
  }, overrides || {});
}

function manyCustomFields(count) {
  const table = [];
  for (let i = 0; i < count; i += 1) {
    table.push({ fieldKey: 'field' + i, fieldValue: 'v' });
  }
  return table;
}

function assertRefused(result, code) {
  assert.equal(result.supremeConfig, null);
  assert.equal(result.calls.indexOf('supremeSend'), -1);
  assert.equal(result.failureCalls, 1);
  assert.equal(result.successCalls, 0);
  const found = result.logs.some(function (args) {
    return args.some(function (arg) {
      return typeof arg === 'string' && arg.indexOf(code) !== -1;
    });
  });
  assert.equal(found, true, 'expected a log entry containing ' + code);
}

function assertDispatched(result) {
  assert.equal(result.failureCalls, 0);
  assert.notEqual(result.calls.indexOf('supremeSend'), -1);
}

test('page_view is no longer a selectable event choice', function () {
  const params = templateParameters();
  const eventNameParam = params.find(function (param) {
    return param.name === 'eventName';
  });
  const values = eventNameParam.selectItems.map(function (item) {
    return item.value;
  });

  assert.equal(values.includes('page_view'), false);
  assert.notEqual(eventNameParam.defaultValue, 'page_view');
});

test('only the declared permissions are requested', function () {
  const permissions = webPermissions();
  const publicIds = permissions.map(function (permission) {
    return permission.instance.key.publicId;
  });

  assert.deepEqual(publicIds.sort(), ['access_globals', 'get_url', 'logging']);

  const accessGlobals = permissions.find(function (permission) {
    return permission.instance.key.publicId === 'access_globals';
  });
  const keysParam = accessGlobals.instance.param.find(function (param) {
    return param.key === 'keys';
  });
  const keys = keysParam.value.listItem.map(function (item) {
    const keyIndex = item.mapKey.findIndex(function (entry) {
      return entry.string === 'key';
    });
    return item.mapValue[keyIndex].string;
  });

  assert.deepEqual(keys, ['supremeSend']);
});

test('a legacy saved page_view tag succeeds without dispatching', function () {
  const result = runTemplate({
    eventName: 'page_view'
  });

  assert.equal(result.supremeConfig, null);
  assert.deepEqual(result.calls, []);
  assert.equal(result.successCalls, 1);
  assert.equal(result.failureCalls, 0);
});

test('a custom event literally named page_view also succeeds without dispatching', function () {
  const result = runTemplate({
    eventName: 'custom',
    customEventName: 'page_view'
  });

  assert.equal(result.supremeConfig, null);
  assert.equal(result.successCalls, 1);
});

test('root provenance and per-event delivery are emitted on a real dispatch', function () {
  const result = runTemplate({
    eventName: 'lead',
    paramTable1: [
      { userParameter: 'email', userParameterValue: 'lead@example.com' }
    ]
  });

  const payload = result.supremeConfig.payload;
  assert.equal(payload.source_platform, 'gtm');
  assert.equal(payload.provider, 'gtm');
  assert.equal(payload.action_source, 'browser');
  assert.deepEqual(payload.events[0].data._delivery, { source: 'gtm_event_tag', mode: 'supreme_send' });
});

test('date_of_birth user parameter maps to canonical birth_date', function () {
  const result = runTemplate({
    eventName: 'lead',
    paramTable1: [
      { userParameter: 'date_of_birth', userParameterValue: '1990-01-02' },
      { userParameter: 'email', userParameterValue: 'lead@example.com' }
    ]
  });

  const user = result.supremeConfig.payload.context.user;
  assert.equal(user.birth_date, '1990-01-02');
  assert.equal(user.email, 'lead@example.com');
  assert.equal(Object.prototype.hasOwnProperty.call(user, 'date_of_birth'), false);
});

test('explicit eventId wins over a generated id', function () {
  const result = runTemplate({
    eventName: 'purchase',
    eventId: 'evt_operator'
  });

  assert.equal(result.supremeConfig.payload.events[0].id, 'evt_operator');
});

test('a blank eventId falls back to a generated id', function () {
  const result = runTemplate({
    eventName: 'purchase'
  }, {
    generateRandom: function () { return 444444444; },
    getTimestampMillis: function () { return 1700000000006; }
  });

  assert.equal(result.supremeConfig.payload.events[0].id, 'evt_1700000000006_444444444');
});

test('identity cookies and GA4 ids stay uncollected in the template payload', function () {
  const result = runTemplate({
    eventName: 'purchase',
    eventId: 'evt_test_1'
  });

  assert.equal(result.calls.filter(function (name) { return name !== 'supremeSend'; }).length, 0);
  const user = result.supremeConfig.payload.context.user;
  assert.equal(user.stuid, undefined);
  assert.equal(user.fbp, undefined);
  assert.equal(user.fbc, undefined);
  assert.equal(user.ga_client_id, undefined);
});

test('lead identity block adds full_name, company, job_title and street2 without disturbing existing fields', function () {
  const params = templateParameters();
  const customerInformation = params.find(function (param) { return param.name === 'customerInformation'; });
  const paramTable1 = customerInformation.subParams.find(function (param) { return param.name === 'paramTable1'; });
  const userParameterColumn = paramTable1.paramTableColumns[0].param;
  const values = userParameterColumn.selectItems.map(function (item) { return item.value; });

  assert.deepEqual(values, [
    'first_name', 'last_name', 'full_name', 'phone', 'email', 'company', 'job_title',
    'gender', 'date_of_birth', 'street', 'street2', 'city', 'state', 'zip', 'country'
  ]);
});

test('leadBlock is scoped to eventName lead and ecommerceBlock stays byte-identical', function () {
  const params = templateParameters();
  const leadBlock = params.find(function (param) { return param.name === 'leadBlock'; });

  assert.deepEqual(leadBlock.enablingConditions, [
    { paramName: 'eventName', paramValue: 'lead', type: 'EQUALS' }
  ]);

  const subParamNames = leadBlock.subParams.map(function (param) { return param.name; });
  assert.deepEqual(subParamNames, [
    'leadStatus', 'leadSource', 'sourceLeadId', 'leadValue', 'leadCurrency', 'customFieldsTable'
  ]);
  leadBlock.subParams.forEach(function (param) {
    assert.equal(param.valueValidators, undefined);
  });

  const ecommerceBlock = params.find(function (param) { return param.name === 'ecommerceBlock'; });
  assert.deepEqual(ecommerceBlock, {
    type: 'GROUP',
    name: 'ecommerceBlock',
    displayName: '',
    groupStyle: 'NO_ZIPPY',
    subParams: [
      {
        type: 'TEXT',
        name: 'currency',
        displayName: 'Currency',
        simpleValueType: true,
        valueHint: 'BRL',
        valueValidators: [{ type: 'NON_EMPTY' }]
      },
      {
        type: 'TEXT',
        name: 'value',
        displayName: 'Value',
        simpleValueType: true,
        valueHint: '97.54',
        valueValidators: [{ type: 'NON_EMPTY' }]
      },
      {
        type: 'SIMPLE_TABLE',
        name: 'itemsTable',
        displayName: 'Items',
        simpleTableColumns: [
          { defaultValue: '', displayName: 'Item ID', name: 'item_id', type: 'TEXT' },
          { defaultValue: '', displayName: 'Item Name', name: 'item_name', type: 'TEXT' },
          {
            defaultValue: '',
            displayName: 'Price',
            name: 'price',
            type: 'TEXT',
            valueValidators: [{ type: 'NON_EMPTY' }]
          },
          {
            defaultValue: 1,
            displayName: 'Quantity',
            name: 'quantity',
            type: 'TEXT',
            valueValidators: [{ type: 'POSITIVE_NUMBER' }]
          }
        ]
      }
    ],
    enablingConditions: [
      { paramName: 'eventName', paramValue: 'initiate_checkout', type: 'EQUALS' },
      { paramName: 'eventName', paramValue: 'purchase', type: 'EQUALS' },
      { paramName: 'eventName', paramValue: 'add_to_cart', type: 'EQUALS' },
      { paramName: 'eventName', paramValue: 'view_item', type: 'EQUALS' }
    ]
  });
});

test('a lead with identity and the lead block produces a typed params.lead', function () {
  const result = runTemplate({
    eventName: 'lead',
    paramTable1: [
      { userParameter: 'email', userParameterValue: 'lead@example.com' }
    ],
    leadStatus: 'qualified',
    leadSource: 'landing-page',
    sourceLeadId: 'form-2026-0001',
    leadValue: '150.5',
    leadCurrency: 'BRL',
    customFieldsTable: [
      { fieldKey: 'plan_interest', fieldValue: 'pro' },
      { fieldKey: 'employees', fieldValue: '12' },
      { fieldKey: 'newsletter', fieldValue: 'true' }
    ]
  });

  const params = result.supremeConfig.payload.events[0].data.params;
  assert.equal(params.value, 150.5);
  assert.equal(params.currency, 'BRL');
  assert.deepEqual(params.lead, {
    status: 'qualified',
    source: 'landing-page',
    source_lead_id: 'form-2026-0001',
    custom_fields: {
      plan_interest: 'pro',
      employees: 12,
      newsletter: true
    }
  });
});

test('a lead with only identity and no lead-block fields omits params.lead', function () {
  const result = runTemplate({
    eventName: 'lead',
    paramTable1: [
      { userParameter: 'email', userParameterValue: 'lead@example.com' }
    ]
  });

  const params = result.supremeConfig.payload.events[0].data.params;
  assert.equal(Object.prototype.hasOwnProperty.call(params, 'lead'), false);
});

test('lead-only fields never leak into a purchase payload', function () {
  const purchaseInput = {
    eventName: 'purchase',
    eventId: 'evt_purchase_1',
    currency: 'USD',
    value: '10.00'
  };
  const base = runTemplate(purchaseInput);
  const withLeadFields = runTemplate(Object.assign({}, purchaseInput, {
    leadStatus: 'qualified',
    leadSource: 'landing-page',
    sourceLeadId: 'form-2026-0001',
    leadValue: '150.5',
    leadCurrency: 'BRL',
    customFieldsTable: [{ fieldKey: 'plan_interest', fieldValue: 'pro' }]
  }));

  assert.deepEqual(withLeadFields.supremeConfig, base.supremeConfig);
});

test('a lead without email or phone is refused with identity_required', function () {
  const result = runTemplate(validLeadInput({
    paramTable1: [
      { userParameter: 'first_name', userParameterValue: 'Maria' }
    ]
  }));
  assertRefused(result, 'identity_required');
});

test('a lead event id over 50 UTF-8 bytes is refused with event_id_too_long, 50 bytes is accepted', function () {
  const tooLong = runTemplate(validLeadInput({ eventId: 'a'.repeat(49) + 'é' }));
  assertRefused(tooLong, 'event_id_too_long');

  const atLimit = runTemplate(validLeadInput({ eventId: 'a'.repeat(48) + 'é' }));
  assertDispatched(atLimit);
});

test('an unknown lead status is refused with lead_status_invalid', function () {
  const result = runTemplate(validLeadInput({ leadStatus: 'open' }));
  assertRefused(result, 'lead_status_invalid');
});

test('a lead source with invalid characters is refused with lead_source_invalid', function () {
  assertRefused(runTemplate(validLeadInput({ leadSource: 'Landing Page' })), 'lead_source_invalid');
  assertRefused(runTemplate(validLeadInput({ leadSource: '-landing' })), 'lead_source_invalid');
});

test('a source lead id with a control character or over 191 characters is refused, 191 is accepted', function () {
  assertRefused(runTemplate(validLeadInput({ sourceLeadId: 'form-\n-0001' })), 'source_lead_id_invalid');
  assertRefused(runTemplate(validLeadInput({ sourceLeadId: 'x'.repeat(192) })), 'source_lead_id_invalid');
  assertDispatched(runTemplate(validLeadInput({ sourceLeadId: 'x'.repeat(191) })));
});

test('a custom field key with an invalid format is refused with custom_field_key_invalid', function () {
  ['Plan', '1plan', 'a'.repeat(65)].forEach(function (key) {
    const result = runTemplate(validLeadInput({
      customFieldsTable: [{ fieldKey: key, fieldValue: 'x' }]
    }));
    assertRefused(result, 'custom_field_key_invalid');
  });
});

test('a reserved custom field key is refused with custom_field_key_reserved', function () {
  ['email', 'utm_source'].forEach(function (key) {
    const result = runTemplate(validLeadInput({
      customFieldsTable: [{ fieldKey: key, fieldValue: 'x' }]
    }));
    assertRefused(result, 'custom_field_key_reserved');
  });
});

test('a custom field value that is an array or object is refused with custom_field_value_not_scalar', function () {
  const withObject = runTemplate(validLeadInput({
    customFieldsTable: [{ fieldKey: 'meta', fieldValue: { a: 1 } }]
  }));
  assertRefused(withObject, 'custom_field_value_not_scalar');

  const withArray = runTemplate(validLeadInput({
    customFieldsTable: [{ fieldKey: 'meta', fieldValue: [1] }]
  }));
  assertRefused(withArray, 'custom_field_value_not_scalar');
});

test('more than 50 custom fields is refused with custom_fields_too_many, 50 is accepted', function () {
  const tooMany = runTemplate(validLeadInput({ customFieldsTable: manyCustomFields(51) }));
  assertRefused(tooMany, 'custom_fields_too_many');

  const atLimit = runTemplate(validLeadInput({ customFieldsTable: manyCustomFields(50) }));
  assertDispatched(atLimit);
});

test('custom_fields JSON over 16384 UTF-8 bytes is refused with custom_fields_too_large, 16384 is accepted', function () {
  const tooLarge = runTemplate(validLeadInput({
    customFieldsTable: [{ fieldKey: 'notes', fieldValue: 'x'.repeat(16373) }]
  }));
  assertRefused(tooLarge, 'custom_fields_too_large');

  const atLimit = runTemplate(validLeadInput({
    customFieldsTable: [{ fieldKey: 'notes', fieldValue: 'x'.repeat(16372) }]
  }));
  assertDispatched(atLimit);
});

test('a lead value that is non-numeric, negative or comma-decimal is refused with value_invalid', function () {
  ['abc', '-1', '1,5'].forEach(function (leadValue) {
    const result = runTemplate(validLeadInput({ leadValue: leadValue }));
    assertRefused(result, 'value_invalid');
  });
});

test('a lead currency outside the 3-letter uppercase code is refused with currency_invalid', function () {
  ['brl', 'BR', 'BRLL'].forEach(function (leadCurrency) {
    const result = runTemplate(validLeadInput({ leadCurrency: leadCurrency }));
    assertRefused(result, 'currency_invalid');
  });
});

test('a lead value without a currency is refused with currency_required', function () {
  const result = runTemplate(validLeadInput({ leadCurrency: undefined }));
  assertRefused(result, 'currency_required');
});

test('a purchase with a 60-byte event id and no identity still dispatches — only lead is validated', function () {
  const result = runTemplate({
    eventName: 'purchase',
    eventId: 'p'.repeat(60),
    currency: 'USD',
    value: '10.00'
  });
  assertDispatched(result);
});

test('the full valid lead-contract-v1 lead passes validation and dispatches once', function () {
  const result = runTemplate(validLeadInput());
  assert.equal(result.failureCalls, 0);
  assert.equal(result.calls.filter(function (name) { return name === 'supremeSend'; }).length, 1);
});

test('the fixed canonical lead-contract-v1 string matches its own pinned sha256', function () {
  const sha = crypto.createHash('sha256').update(CANONICAL_GTM_LEAD_JSON, 'utf8').digest('hex');
  assert.equal(sha, CANONICAL_GTM_LEAD_SHA256);
});

test('the tag output for the lead-contract-v1 fixture is canonically identical to the Node fixture', function () {
  const result = runTemplate(validLeadInput(), {
    getUrl: function () { return 'https://example.com/contato'; },
    getTimestampMillis: function () { return 1790000000000; }
  });
  const canonicalPayload = canonicalJson(result.supremeConfig.payload);
  assert.equal(canonicalPayload, CANONICAL_GTM_LEAD_JSON);
});

test('the committed lead-contract-v1 fixture file is canonically identical to the Node fixture and up to date', function () {
  const fixturePath = path.join(__dirname, 'lead-contract-v1', 'gtm.lead.json');
  const parsed = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(canonicalJson(parsed), CANONICAL_GTM_LEAD_JSON);

  const generatorPath = path.join(__dirname, 'generate-lead-contract-v1.js');
  const check = spawnSync(process.execPath, [generatorPath, '--check']);
  assert.equal(check.status, 0, (check.stderr || Buffer.from('')).toString());
});
