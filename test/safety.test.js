import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { exitOnUnhandledRejection } from '../src/safety.js';

test('une promesse rejetée non gérée est journalisée puis arrête le processus', () => {
  const logged = [];
  const exits = [];
  const handler = exitOnUnhandledRejection({
    logger: { error: (...args) => logged.push(args) },
    exit: (code) => exits.push(code),
  });
  try {
    assert.ok(process.listeners('unhandledRejection').includes(handler));

    const reason = new Error('boom');
    handler(reason);

    assert.equal(logged.length, 1);
    assert.ok(logged[0].includes(reason), 'la cause doit être journalisée');
    assert.deepEqual(exits, [1]);
  } finally {
    process.off('unhandledRejection', handler);
  }
});

test('dans un vrai processus : code de sortie 1 et cause dans les logs', () => {
  const moduleUrl = new URL('../src/safety.js', import.meta.url).href;
  const script = [
    `import { logger } from '@gladysassistant/integration-sdk';`,
    `import { exitOnUnhandledRejection } from '${moduleUrl}';`,
    `exitOnUnhandledRejection({ logger });`,
    `Promise.reject(new Error('cause-visible'));`,
  ].join('\n');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(child.status, 1);
  assert.match(child.stdout + child.stderr, /cause-visible/);
});
