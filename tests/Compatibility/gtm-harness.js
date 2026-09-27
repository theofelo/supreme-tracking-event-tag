const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATE_PATH = path.join(ROOT, 'template.tpl');

const GTM_STRING_METHODS = [
  'charAt', 'concat', 'indexOf', 'lastIndexOf', 'match', 'replace', 'search', 'slice', 'split',
  'substring', 'toLowerCase', 'toLocaleLowerCase', 'toString', 'toUpperCase', 'toLocaleUpperCase', 'trim'
];
const GTM_ARRAY_METHODS = [
  'concat', 'every', 'filter', 'forEach', 'indexOf', 'join', 'lastIndexOf', 'map', 'pop', 'push', 'reduce',
  'reduceRight', 'reverse', 'shift', 'slice', 'some', 'sort', 'splice', 'toString', 'unshift'
];
const GTM_ABSENT_GLOBALS = [
  'Object', 'String', 'Number', 'Boolean', 'Array', 'Math', 'JSON', 'Date', 'RegExp', 'Symbol', 'Map', 'Set',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent'
];
const GTM_SANDBOX_PRELUDE = '(function (stringOk, arrayOk, absent) {'
  + ' var sp = "".constructor.prototype; var ap = [].constructor.prototype;'
  + ' Object.getOwnPropertyNames(sp).forEach(function (k) { if (k !== "constructor" && k !== "length" && k !== "valueOf" && stringOk.indexOf(k) === -1) delete sp[k]; });'
  + ' Object.getOwnPropertyNames(ap).forEach(function (k) { if (k !== "constructor" && k !== "length" && arrayOk.indexOf(k) === -1) delete ap[k]; });'
  + ' absent.forEach(function (name) { globalThis[name] = undefined; });'
  + ' })';

function createGtmContext(sandbox) {
  const context = vm.createContext(sandbox);
  vm.runInContext(GTM_SANDBOX_PRELUDE, context)(GTM_STRING_METHODS, GTM_ARRAY_METHODS, GTM_ABSENT_GLOBALS);
  return context;
}

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
        case 'makeNumber':
          return function (value) {
            return Number(value);
          };
        case 'getType':
          return function (value) {
            if (value === null) return 'null';
            if (Array.isArray(value)) return 'array';
            return typeof value;
          };
        case 'JSON':
          return JSON;
        case 'makeString':
          return function (value) {
            return String(value);
          };
        case 'Object':
          return {
            keys: Object.keys,
            values: Object.values,
            entries: Object.entries,
            freeze: Object.freeze,
            delete: function (target, key) {
              return delete target[key];
            }
          };
        default:
          throw new Error('Unmocked require in gtm-harness: ' + name);
      }
    }
  };

  const context = createGtmContext(sandbox);
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
  runTemplate,
  createGtmContext
};
