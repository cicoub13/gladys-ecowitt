import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startReceiver } from '../src/receiver/server.js';
import { createReceiverClient } from '../src/receiver/client.js';
import { toEcowittPayload } from '../src/sources/wunderground.js';
import { toObservation } from '../src/sources/pushAdapter.js';

/** Port libre, pour ne pas dépendre d'un port fixe pendant les tests. */
const PORT = 18_080 + Math.floor(Math.random() * 1000);

/**
 * Démarre un receiver sur un couple de ports propre au test : le port publié
 * sur le LAN et le port interne, réservé au conteneur principal.
 */
const start = async (t, offset) => {
  const port = PORT + offset;
  const internalPort = PORT + 1000 + offset;
  const receiver = await startReceiver({ port, internalPort });
  t.after(() => receiver.close());
  return {
    publicUrl: `http://127.0.0.1:${port}`,
    internalUrl: `http://127.0.0.1:${internalPort}`,
  };
};

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
  const { publicUrl, internalUrl } = await start(t, 0);
  const received = [];
  const client = createReceiverClient({
    baseUrl: internalUrl,
    onReading: (reading) => received.push(reading),
  });
  client.start();
  t.after(() => client.stop());

  // Laisser le flux s'établir avant le premier envoi.
  assert.ok(
    await waitFor(
      async () => (await (await fetch(`${internalUrl}/health`)).json()).subscribers > 0,
    ),
  );

  const response = await fetch(`${publicUrl}/data/report`, {
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
  const { publicUrl, internalUrl } = await start(t, 1);

  const query = new URLSearchParams({
    ID: 'STATION1',
    PASSWORD: 'x',
    tempf: '68.0',
    humidity: '60',
    baromin: '29.92',
    rainin: '0.02',
    action: 'updateraw',
  });
  const response = await fetch(`${publicUrl}/weatherstation/updateweatherstation.php?${query}`);

  assert.equal(response.status, 200);
  // Une station Wunderground signale une erreur si la réponse n'est pas
  // exactement « success ».
  assert.equal((await response.text()).trim(), 'success');

  const health = await (await fetch(`${internalUrl}/health`)).json();
  assert.equal(health.last.protocol, 'wunderground');

  // Les champs Wunderground sont renommés vers le vocabulaire Ecowitt.
  const payload = toEcowittPayload(health.last.payload);
  assert.equal(payload.PASSKEY, 'STATION1');
  assert.equal(payload.baromrelin, '29.92');
  assert.equal(payload.hourlyrainin, '0.02');
});

test('le mot de passe Wunderground n’est jamais conservé', async (t) => {
  const { publicUrl, internalUrl } = await start(t, 5);

  const query = new URLSearchParams({ ID: 'STATION1', PASSWORD: 'secret-wu-key', tempf: '68.0' });
  await fetch(`${publicUrl}/weatherstation/updateweatherstation.php?${query}`);

  const health = await (await fetch(`${internalUrl}/health`)).json();
  assert.equal(health.last.payload.ID, 'STATION1');
  assert.equal(health.last.payload.PASSWORD, undefined);
});

test('les points d’entrée internes ne sont pas servis sur le port publié', async (t) => {
  const { publicUrl, internalUrl } = await start(t, 6);

  await fetch(`${publicUrl}/data/report`, {
    method: 'POST',
    body: new URLSearchParams({ PASSKEY: 'ABC', tempf: '50.0' }).toString(),
  });

  // Le port publié est joignable par tout le LAN : il ne doit rien révéler
  // du dernier relevé (PASSKEY compris).
  for (const path of ['/events', '/health', '/last']) {
    const response = await fetch(`${publicUrl}${path}`);
    assert.equal(response.status, 404, `${path} ne doit pas exister sur le port publié`);
    await response.body?.cancel();
  }

  // Le port interne, lui, ne reçoit pas d'envoi de station.
  const upload = await fetch(`${internalUrl}/data/report`, { method: 'POST', body: 'tempf=1' });
  assert.equal(upload.status, 404);

  const health = await (await fetch(`${internalUrl}/health`)).json();
  assert.equal(health.last.payload.PASSKEY, 'ABC');
});

test('le dernier relevé est rejoué à la connexion au flux', async (t) => {
  const { publicUrl, internalUrl } = await start(t, 2);

  await fetch(`${publicUrl}/data/report`, {
    method: 'POST',
    body: new URLSearchParams({ PASSKEY: 'ABC', tempf: '50.0' }).toString(),
  });

  // Un client qui se connecte APRÈS l'envoi ne doit pas attendre le relevé
  // suivant, qui peut être à plusieurs minutes.
  const received = [];
  const client = createReceiverClient({
    baseUrl: internalUrl,
    onReading: (reading) => received.push(reading),
  });
  client.start();
  t.after(() => client.stop());

  assert.ok(await waitFor(() => received.length > 0));
  assert.equal(received[0].payload.tempf, '50.0');
});

test('un corps surdimensionné est rejeté', async (t) => {
  const { publicUrl } = await start(t, 3);

  const response = await fetch(`${publicUrl}/data/report`, {
    method: 'POST',
    body: 'x'.repeat(70 * 1024),
  }).catch((err) => err);

  // Selon le moment où la connexion est coupée, le client voit un 413 ou une
  // erreur réseau : les deux valent refus.
  const status = response instanceof Error ? 413 : response.status;
  assert.equal(status, 413);
});

test('un chemin illisible est refusé sans faire tomber le receiver', async (t) => {
  const { publicUrl } = await start(t, 4);
  const port = PORT + 4;

  // `fetch` normalise le chemin : il faut une requête brute pour envoyer
  // « // », que `new URL` refuse — ce que fait n'importe quel scanner du LAN.
  const statusLine = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write('GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    });
    socket.setTimeout(1_000, () => socket.destroy(new Error('aucune réponse')));
    socket.once('data', (data) => resolve(data.toString().split('\r\n')[0]));
    socket.once('error', reject);
  });
  assert.equal(statusLine, 'HTTP/1.1 400 Bad Request');

  const response = await fetch(`${publicUrl}/data/report`, {
    method: 'POST',
    body: new URLSearchParams({ PASSKEY: 'ABC', tempf: '50.0' }).toString(),
  });
  assert.equal(response.status, 200, 'le receiver doit toujours répondre');
});
