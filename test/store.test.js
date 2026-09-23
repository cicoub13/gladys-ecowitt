import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';
import { toObservation } from '../src/sources/pushAdapter.js';
import { WS2910_PAYLOAD } from './fixtures/ws2910.js';

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ecowitt-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('l’état est écrit en 0600, sans fichier temporaire résiduel', async (t) => {
  const dir = await tempDir(t);
  const path = join(dir, 'state.json');
  // Un fichier laissé par une version précédente, lisible par tous.
  await writeFile(path, '{}', { mode: 0o644 });

  const store = createStore({ path });
  store.merge(toObservation(WS2910_PAYLOAD));
  await store.save();

  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(dir), ['state.json']);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).stationId, store.state.stationId);
});

test('des sauvegardes simultanées laissent un fichier complet', async (t) => {
  const dir = await tempDir(t);
  const path = join(dir, 'state.json');
  const store = createStore({ path });
  store.merge(toObservation(WS2910_PAYLOAD));

  // Arrêt pendant une sauvegarde différée : deux écritures se croisent.
  await Promise.all([store.save(), store.save(), store.save()]);

  const reloaded = createStore({ path });
  await reloaded.load();
  assert.deepEqual(reloaded.state, store.state);
  assert.deepEqual(await readdir(dir), ['state.json']);
});

test('un fichier tronqué ou mal formé est ignoré, jamais fatal', async (t) => {
  const dir = await tempDir(t);
  const path = join(dir, 'state.json');
  const store = createStore({ path });

  for (const content of ['{"stationId": "AB', 'null', '[]', '"texte"', '{"sensors": 5}']) {
    await writeFile(path, content);
    const state = await store.load();
    assert.equal(typeof state.sensors, 'object', `contenu ${content}`);
    assert.ok(!Array.isArray(state.sensors), `contenu ${content}`);
    // L'état rechargé doit rester utilisable.
    assert.doesNotThrow(() => store.merge(toObservation(WS2910_PAYLOAD)), `contenu ${content}`);
  }
});
