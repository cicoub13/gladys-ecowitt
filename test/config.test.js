import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { buildDiscoveredDevices } from '../src/gladys/buildDevices.js';
import { createStore } from '../src/store.js';
import { toObservation } from '../src/sources/pushAdapter.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { WS2910_PAYLOAD } from './fixtures/ws2910.js';

/**
 * Intervalles acceptés par le cœur de Gladys sur un device publié, en
 * millisecondes (`DEVICE_POLL_FREQUENCIES`, vérifié par
 * `externalIntegration.setDiscoveredDevices`). Toute autre valeur fait
 * rejeter la publication entière.
 */
const CORE_POLL_FREQUENCIES_MS = [1000, 2000, 10000, 15000, 30000, 60000];

test('l’intervalle de polling est ramené aux valeurs que Gladys accepte', () => {
  assert.equal(normalizeConfig({ poll_frequency: 30 }).poll_frequency, 30);
  assert.equal(normalizeConfig({ poll_frequency: 60 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: '30' }).poll_frequency, 30);
  // Valeurs saisies avant la correction (le champ allait jusqu'à 3600 s).
  assert.equal(normalizeConfig({ poll_frequency: 120 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 3600 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 10 }).poll_frequency, 30);
  // À égale distance, le plus lent : moins de requêtes à la passerelle.
  assert.equal(normalizeConfig({ poll_frequency: 45 }).poll_frequency, 60);
  // Valeur absente ou illisible : la valeur par défaut, jamais NaN.
  assert.equal(normalizeConfig({}).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: null }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: '' }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: true }).poll_frequency, 60);
});

test('poll_frequency est publié en millisecondes, dans l’ensemble du cœur', () => {
  const gladys = createFakeGladys();
  const store = createStore({ path: 'unused.json' });
  store.merge(toObservation(WS2910_PAYLOAD));

  for (const seconds of [30, 60]) {
    const devices = buildDiscoveredDevices(gladys, store.state, { pollFrequency: seconds });
    assert.ok(devices.length > 0);
    for (const device of devices) {
      assert.equal(device.poll_frequency, seconds * 1000);
      assert.ok(CORE_POLL_FREQUENCIES_MS.includes(device.poll_frequency));
    }
  }
});
