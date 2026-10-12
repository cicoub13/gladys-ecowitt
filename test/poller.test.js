import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPoller } from '../src/poller.js';

// Seul `setInterval` est simulé : `setImmediate` passe une fois toutes les
// promesses en attente résolues, donc une lecture qui n'attend que des faux.
const flush = () => new Promise((resolve) => setImmediate(resolve));

const tick = async (t, ms) => {
  t.mock.timers.tick(ms);
  await flush();
};

test('une lecture tout de suite, puis une par intervalle', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let runs = 0;
  const poller = createPoller({ run: async () => runs++ });

  await poller.start(60);
  assert.equal(runs, 1);

  await tick(t, 59_999);
  assert.equal(runs, 1);
  await tick(t, 1);
  assert.equal(runs, 2);
  await tick(t, 60_000);
  assert.equal(runs, 3);
  poller.stop();
});

test('start réarme la boucle : l’ancien intervalle disparaît', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let runs = 0;
  const poller = createPoller({ run: async () => runs++ });

  await poller.start(60);
  await poller.start(30);
  assert.equal(runs, 2); // chaque (ré)armement lit tout de suite

  // 60 s font deux lectures à 30 s, pas trois avec l'ancien minuteur.
  await tick(t, 30_000);
  await tick(t, 30_000);
  assert.equal(runs, 4);
  poller.stop();
});

test('un tick pendant une lecture en cours est sauté', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let runs = 0;
  let release;
  const poller = createPoller({
    run: () => {
      runs += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });

  const first = poller.start(30);
  await tick(t, 30_000);
  await tick(t, 30_000);
  assert.equal(runs, 1, 'la lecture bloquée n’est jamais doublée');

  release();
  await first;
  await tick(t, 30_000);
  assert.equal(runs, 2);
  release();
  poller.stop();
});

test('une lecture en échec n’arrête pas la boucle', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let runs = 0;
  const poller = createPoller({
    run: async () => {
      runs += 1;
      throw new Error('passerelle injoignable');
    },
  });

  await poller.start(30); // ne rejette pas
  await tick(t, 30_000);
  await tick(t, 30_000);
  assert.equal(runs, 3);
  poller.stop();
});

test('stop ne laisse aucun minuteur', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let runs = 0;
  const poller = createPoller({ run: async () => runs++ });

  await poller.start(30);
  poller.stop();
  await tick(t, 600_000);
  assert.equal(runs, 1);
  poller.stop(); // idempotent
});
