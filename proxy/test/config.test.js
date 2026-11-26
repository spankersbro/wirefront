const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requiredEnv, positiveNumberEnv } = require('../src/config');

test('a missing or blank setting stops startup', () => {
  assert.throws(() => requiredEnv({}, 'A'), /Missing environment variable A/);
  assert.throws(() => requiredEnv({ A: '  ' }, 'A'), /Missing/);
  assert.equal(requiredEnv({ A: ' x ' }, 'A'), 'x');
});

test('a limit that is not a positive number stops startup', () => {
  for (const value of ['9OO', 'NaN', '0', '-1', 'Infinity']) {
    assert.throws(() => positiveNumberEnv({ L: value }, 'L'), /positive number/, value);
  }
  assert.equal(positiveNumberEnv({ L: '0.18' }, 'L'), 0.18);
});
