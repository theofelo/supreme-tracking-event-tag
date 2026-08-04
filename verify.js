#!/usr/bin/env node
/**
 * Satellite verification entry point. Truth is the exit code.
 *
 *   node verify.js                    # suites selected from `git diff --name-only`
 *   node verify.js --all              # every suite
 *   node verify.js --suite=contract   # one suite
 *   node verify.js --list             # show the map, run nothing
 *
 * Report format is the workspace contract, identical in every repo:
 *   SUITE <name> <PASS|FAIL|SKIP> <passed>/<total> <ms>ms
 *   VERIFY <repo> <PASS|FAIL> <passedSuites>/<selectedSuites>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const root = __dirname;
const mapPath = path.join(root, '.verify', 'map.json');

if (!fs.existsSync(mapPath)) {
  process.stderr.write('missing .verify/map.json\n');
  process.exit(2);
}
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const repo = map.repo || path.basename(root);

const opts = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
  if (m) opts[m[1]] = m[2] === undefined ? true : m[2];
}

if (opts.list) {
  for (const [name, s] of Object.entries(map.suites)) {
    process.stdout.write(name.padEnd(12) + ' ' + (s.describe || '') + '\n');
  }
  process.exit(0);
}

function git(args) {
  try {
    return execSync('git ' + args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    return null;
  }
}

function changedFiles() {
  const out = [];
  const base = (git('merge-base HEAD origin/main') || '').trim();
  if (base) {
    const diff = git('diff --name-only ' + base);
    if (diff) out.push.apply(out, diff.trim().split('\n'));
  }
  const dirty = git('status --porcelain');
  if (dirty === null && !base) return null;
  for (const l of (dirty || '').trim().split('\n')) {
    if (l.trim()) out.push(l.trim().slice(2).trim());
  }
  const norm = out.map((p) => p.replace(/\\/g, '/').trim()).filter(Boolean);
  return Array.from(new Set(norm));
}

/** Glob to RegExp: a single `*` stops at a path separator, `**` crosses them. */
function globToRegExp(g) {
  let out = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if ('.+^${}()|[]\\?'.indexOf(c) !== -1) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp('^' + out + '$');
}

function matchesAny(paths, globs) {
  for (const g of globs || []) {
    const re = globToRegExp(g);
    if (paths.some((p) => re.test(p))) return true;
  }
  return false;
}

let suites = map.suites;
let changed = [];
let selection = '--all';

if (opts.suite) {
  if (!suites[opts.suite]) {
    process.stderr.write('unknown suite: ' + opts.suite + '\n');
    process.exit(2);
  }
  suites = { [opts.suite]: suites[opts.suite] };
  selection = '--suite=' + opts.suite;
} else if (!opts.all) {
  const c = changedFiles();
  if (c === null) {
    process.stderr.write('no git diff available — falling back to --all\n');
  } else {
    changed = c;
    selection = 'git diff (' + c.length + ' changed file' + (c.length === 1 ? '' : 's') + ')';
    suites = Object.fromEntries(
      Object.entries(suites).filter(([, s]) => s.always || matchesAny(changed, s.when))
    );
  }
}

process.stdout.write('== verify: ' + repo + ' ==\nselected by: ' + selection + '\n\n');

if (!Object.keys(suites).length) {
  process.stdout.write('VERIFY ' + repo + ' PASS 0/0\nno suite matched the changed files\n');
  process.exit(0);
}

let failed = 0;
let passedSuites = 0;
let selected = 0;

for (const [name, s] of Object.entries(suites)) {
  selected++;
  const t0 = Date.now();
  let pass = 0;
  let total = 0;
  const lines = [];

  for (const rel of s.tests || []) {
    const abs = path.join(root, rel);
    total++;
    if (!fs.existsSync(abs)) {
      lines.push('MISSING ' + rel);
      continue;
    }
    let out = '';
    let ok = true;
    try {
      out = execFileSync(process.execPath, ['--test', abs], { encoding: 'utf8', cwd: root });
    } catch (e) {
      ok = false;
      out = String(e.stdout || '') + String(e.stderr || '');
    }
    const m = /^# pass (\d+)/m.exec(out);
    const f = /^# fail (\d+)/m.exec(out);
    const checks = m ? Number(m[1]) : 0;
    if (ok && (!f || Number(f[1]) === 0)) {
      pass++;
      lines.push(rel + ' — ' + checks + ' check' + (checks === 1 ? '' : 's'));
    } else {
      lines.push('FAILED ' + rel);
      const detail = out.split('\n').filter((x) => /^not ok|Error:/.test(x)).slice(0, 5);
      for (const l of detail) lines.push('    ' + l.trim());
    }
  }

  const ms = Date.now() - t0;
  const status = total === 0 ? 'SKIP' : pass === total ? 'PASS' : 'FAIL';
  process.stdout.write('SUITE ' + name.padEnd(12) + ' ' + status.padEnd(4) + ' ' + pass + '/' + total + ' ' + ms + 'ms\n');
  for (const l of lines) process.stdout.write('  ' + l + '\n');

  if (status === 'FAIL') failed++;
  else passedSuites++;
}

process.stdout.write('\nVERIFY ' + repo + ' ' + (failed === 0 ? 'PASS' : 'FAIL') + ' ' + passedSuites + '/' + selected + '\n');
process.exit(failed === 0 ? 0 : 1);
