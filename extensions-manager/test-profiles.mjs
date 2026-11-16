// node --test test-profiles.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { capture, matches, changes } from './profiles.js';

const exts = [
  { id: 'a', enabled: true }, { id: 'b', enabled: false }, { id: 'c', enabled: true },
];

test('capture splits on and off', () => {
  assert.deepEqual(capture(exts), { on: ['a', 'c'], off: ['b'] });
});

test('a fresh capture matches, a flipped one does not', () => {
  assert.ok(matches(capture(exts), exts));
  assert.ok(!matches({ on: ['b'], off: ['a'] }, exts));
});

test('extensions installed later and uninstalled ones are ignored', () => {
  const p = { on: ['a', 'gone'], off: ['b'] };
  assert.ok(matches(p, exts));
  assert.deepEqual(changes({ on: ['b'], off: [] }, exts), [['b', true]]);
  assert.ok(!matches({ on: ['gone'], off: [] }, exts));
});
