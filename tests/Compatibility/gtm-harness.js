const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE_PATH = path.join(ROOT, 'template.tpl');

function readTemplateSource() {
  return fs.readFileSync(TEMPLATE_PATH, 'utf8');
}

function extractBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Unable to locate ' + startMarker + ' .. ' + endMarker + ' in template.tpl');
  }
  return source.slice(start + startMarker.length, end);
}

function templateParameters() {
  const source = readTemplateSource();
  const json = extractBlock(source, '___TEMPLATE_PARAMETERS___', '___SANDBOXED_JS_FOR_WEB_TEMPLATE___').trim();
  return JSON.parse(json);
}

function webPermissions() {
  const source = readTemplateSource();
  const json = extractBlock(source, '___WEB_PERMISSIONS___', '___TESTS___').trim();
  return JSON.parse(json);
}

function sandboxedJsSource() {
  const source = readTemplateSource();
  return extractBlock(source, '___SANDBOXED_JS_FOR_WEB_TEMPLATE___', '___WEB_PERMISSIONS___');
}

function runTemplate(data, overrides = {}) {
  const calls = [];
  const logs = [];
  let supremeConfig = null;
  let successCalls = 0;
  let failureCalls = 0;

  const copyFromWindowImpl = overrides.copyFromWindow || function (key) {
    return key === 'supremeSend';
  };
  const getUrlImpl = overrides.getUrl || function () {
    return 'https://example.com/';
  };
  const generateRandomImpl = overrides.generateRandom || function () {
    return 100000000;
  };
  const getTimestampMillisImpl = overrides.getTimestampMillis || function () {
    return 1700000000000;
  };

  const sandboxData = Object.assign({}, data, {
    gtmOnSuccess: function () {
      successCalls += 1;
    },
    gtmOnFailure: function () {
      failureCalls += 1;
    }
  });

  const sandbox = {
    data: sandboxData,
    require: function (name) {
      switch (name) {
        case 'logToConsole':
          return function () {
            logs.push(Array.from(arguments));
          };
        case 'getTimestampMillis':
          return getTimestampMillisImpl;
        case 'generateRandom':
          return generateRandomImpl;
        case 'copyFromWindow':
          return copyFromWindowImpl;
        case 'callInWindow':
          return function (fnName, config) {
            calls.push(fnName);
            if (fnName === 'supremeSend') {
              supremeConfig = JSON.parse(JSON.stringify(config));
            }
          };
        case 'getUrl':
          return getUrlImpl;
        default:
          throw new Error('Unmocked require in gtm-harness: ' + name);
      }
    }
  };

  const context = vm.createContext(sandbox);
  const wrapped = '(function () {\n' + sandboxedJsSource() + '\n})();';
  vm.runInContext(wrapped, context, { filename: TEMPLATE_PATH });

  return {
    supremeConfig,
    calls,
    logs,
    successCalls,
    failureCalls
  };
}

module.exports = {
  ROOT,
  TEMPLATE_PATH,
  templateParameters,
  webPermissions,
  sandboxedJsSource,
  runTemplate
};
