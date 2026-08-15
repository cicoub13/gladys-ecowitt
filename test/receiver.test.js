import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startReceiver } from '../src/receiver/server.js';
import { createReceiverClient } from '../src/receiver/client.js';
import { toEcowittPayload } from '../src/sources/wunderground.js';
import { toObservation } from '../src/sources/pushAdapter.js';

/** Port libre, pour ne pas dépendre d'un port fixe pendant les tests. */
const PORT = 18_080 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const waitFor = async (predicate, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
};

test('le receiver accepte un POST Ecowitt et le diffuse en SSE', async (t) => {
  const receiver = await startReceiver({ port: PORT });
  const received = [];
  const client = createReceiverClient({
    baseUrl: BASE_URL,
    onReading: (reading) => received.push(reading),
  });
  client.start();
  t.after(async () => {
    client.stop();
    await receiver.close();
  });

  // Laisser le flux s'établir avant le premier envoi.
  assert.ok(
    await waitFor(async () => (await (await fetch(`${BASE_URL}/health`)).json()).subscribers > 0),
  );

  const response = await fetch(`${BASE_URL}/data/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ PASSKEY: 'ABC123', tempf: '68.0', humidity: '60' }).toString(),
  });
  assert.equal(response.status, 200);

  assert.ok(await waitFor(() => received.length > 0), 'le relevé doit arriver par le flux');
  assert.equal(received[0].protocol, 'ecowitt');
  assert.equal(received[0].payload.tempf, '68.0');

  // Le relevé traverse toute la chaîne jusqu'à l'observation pivot.
  const observation = toObservation(received[0].payload);
  assert.equal(observation.sensors.find((s) => s.type === 'outdoor').values.temperature, 20);
});

test('le receiver répond au protocole Wunderground ce que la station attend', async (t) => {
  const port = PORT + 1;
  const receiver = await startReceiver({ port });
  t.after(() => receiver.close());

  const query = new URLSearchParams({
    ID: 'STATION1',
    PASSWORD: 'x',
    tempf: '68.0',
    humidity: '60',
    baromin: '29.92',
    rainin: '0.02',
    action: 'updateraw',
  });
  const response = await fetch(
    `http://127.0.0.1:${port}/weatherstation/updateweatherstation.php?${query}`,
  );

  assert.equal(response.status, 200);
  // Une station Wunderground signale une erreur si la réponse n'est pas
  // exactement « success ».
  assert.equal((await response.text()).trim(), 'success');

  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.last.protocol, 'wunderground');

  // Les champs Wunderground sont renommés vers le vocabulaire Ecowitt.
  const payload = toEcowittPayload(health.last.payload);
  assert.equal(payload.PASSKEY, 'STATION1');
  assert.equal(payload.baromrelin, '29.92');
  assert.equal(payload.hourlyrainin, '0.02');
});

test('le dernier relevé est rejoué à la connexion au flux', async (t) => {
  const port = PORT + 2;
  const receiver = await startReceiver({ port });
  t.after(() => receiver.close());

  await fetch(`http://127.0.0.1:${port}/data/report`, {
    method: 'POST',
    body: new URLSearchParams({ PASSKEY: 'ABC', tempf: '50.0' }).toString(),
  });

  // Un client qui se connecte APRÈS l'envoi ne doit pas attendre le relevé
  // suivant, qui peut être à plusieurs minutes.
  const received = [];
  const client = createReceiverClient({
    baseUrl: `http://127.0.0.1:${port}`,
    onReading: (reading) => received.push(reading),
  });
  client.start();
  t.after(() => client.stop());

  assert.ok(await waitFor(() => received.length > 0));
  assert.equal(received[0].payload.tempf, '50.0');
});

test('un corps surdimensionné est rejeté', async (t) => {
  const port = PORT + 3;
  const receiver = await startReceiver({ port });
  t.after(() => receiver.close());

  const response = await fetch(`http://127.0.0.1:${port}/data/report`, {
    method: 'POST',
    body: 'x'.repeat(70 * 1024),
  }).catch((err) => err);

  // Selon le moment où la connexion est coupée, le client voit un 413 ou une
  // erreur réseau : les deux valent refus.
  const status = response instanceof Error ? 413 : response.status;
  assert.equal(status, 413);
});
