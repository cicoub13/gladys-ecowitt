import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createReceiverClient } from '../src/receiver/client.js';

/**
 * Serveur qui accepte les requêtes puis se tait : ni données, ni fin. C'est
 * ce que voit le client face à un receiver figé (boucle d'événements bloquée,
 * conteneur en pause).
 */
async function startSilentServer(t, { sendHeaders }) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (sendHeaders) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.flushHeaders();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}

const waitFor = async (predicate, timeoutMs = 3_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
};

test('un flux muet est abandonné puis rouvert', async (t) => {
  const { baseUrl, requests } = await startSilentServer(t, { sendHeaders: true });
  const client = createReceiverClient({ baseUrl, onReading: () => {}, idleTimeoutMs: 100 });
  client.start();
  t.after(() => client.stop());

  // Sans délai d'inactivité, le client attendrait éternellement la première
  // requête : une seconde connexion prouve qu'il a abandonné la première.
  assert.ok(await waitFor(() => requests.length >= 2), 'le client doit se reconnecter');
});

test('un receiver qui ne répond pas du tout fait aussi abandonner la connexion', async (t) => {
  const { baseUrl, requests } = await startSilentServer(t, { sendHeaders: false });
  const client = createReceiverClient({ baseUrl, onReading: () => {}, idleTimeoutMs: 100 });
  client.start();
  t.after(() => client.stop());

  assert.ok(await waitFor(() => requests.length >= 2), 'le client doit se reconnecter');
});

test('l’état du receiver échoue dans le délai au lieu de pendre', async (t) => {
  const { baseUrl } = await startSilentServer(t, { sendHeaders: false });
  const client = createReceiverClient({ baseUrl, onReading: () => {}, statusTimeoutMs: 100 });

  const started = Date.now();
  await assert.rejects(client.status());
  assert.ok(Date.now() - started < 2_000);
});
