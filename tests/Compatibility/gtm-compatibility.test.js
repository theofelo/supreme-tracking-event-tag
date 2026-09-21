const test = require('node:test');
const assert = require('node:assert/strict');
const { templateParameters, webPermissions, runTemplate } = require('./gtm-harness');

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
    eventName: 'lead'
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
