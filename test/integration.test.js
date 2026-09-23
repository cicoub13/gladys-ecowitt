import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startIntegration } from '../src/integration.js';
import { startReceiver } from '../src/receiver/server.js';
import { createStore } from '../src/store.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { LIVEDATA_IMPERIAL, SENSORS_INFO } from './fixtures/livedata.js';

const newStore = () =>
  createStore({ path: join(tmpdir(), `ecowitt-int-${Math.random().toString(36).slice(2)}.json`) });

const waitFor = async (predicate, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
};

/** Un port libre, que personne n'écoute encore. */
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Passerelle simulée, que le test peut « éteindre » et « rallumer ». */
async function startFakeGateway(t) {
  const gateway = { up: true };
  const server = http.createServer((req, res) => {
    if (!gateway.up) {
      req.socket.destroy(); // passerelle éteinte : la connexion tombe
      return;
    }
    const body = req.url === '/get_sensors_info' ? SENSORS_INFO : LIVEDATA_IMPERIAL;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  gateway.ip = `127.0.0.1:${server.address().port}`;
  return gateway;
}

/** Démarre l'intégration contre le faux Gladys, et l'arrête en fin de test. */
async function start(t, { config, receiverUrl }) {
  const gladys = createFakeGladys({ config });
  await startIntegration({ gladys, store: newStore(), receiverUrl });
  t.after(() => gladys.handlers.shutdown());
  await gladys.handlers.events.connected();
  return gladys;
}

const lastStatus = (gladys) => gladys.connectionStatuses.at(-1);

test('mode local : la passerelle injoignable passe le statut à faux, puis vrai au retour', async (t) => {
  const gateway = await startFakeGateway(t);
  const gladys = await start(t, {
    config: { gateway_ip: gateway.ip },
    receiverUrl: `http://127.0.0.1:${await freePort()}`,
  });
  assert.equal(lastStatus(gladys).connected, true);

  gateway.up = false;
  await assert.rejects(gladys.handlers.poll({ external_id: 'x' }));
  assert.equal(lastStatus(gladys).connected, false);
  assert.match(lastStatus(gladys).message.en, new RegExp(gateway.ip.replace('.', '\\.')));
  assert.ok(lastStatus(gladys).message.fr);

  // Un second échec ne renvoie pas le même statut.
  const count = gladys.connectionStatuses.length;
  await assert.rejects(gladys.handlers.poll({ external_id: 'x' }));
  assert.equal(gladys.connectionStatuses.length, count);

  gateway.up = true;
  await gladys.handlers.poll({ external_id: 'x' });
  assert.equal(lastStatus(gladys).connected, true);
  assert.ok(gladys.published.length > 0, 'les états sont republiés au retour');
});

test('mode push : le receiver injoignable passe le statut à faux, puis vrai au retour', async (t) => {
  const port = await freePort();
  const internalPort = await freePort();
  const gladys = await start(t, {
    config: {},
    receiverUrl: `http://127.0.0.1:${internalPort}`,
  });

  assert.ok(
    await waitFor(() => lastStatus(gladys)?.connected === false),
    'le statut doit signaler le receiver injoignable',
  );
  assert.ok(lastStatus(gladys).message.en);

  const receiver = await startReceiver({ port, internalPort });
  t.after(() => receiver.close());

  assert.ok(
    await waitFor(() => lastStatus(gladys).connected === true),
    'le statut doit revenir à vrai une fois le flux rétabli',
  );
});

test('à la reconnexion à Gladys, le statut renvoyé reflète la source', async (t) => {
  const gateway = await startFakeGateway(t);
  const gladys = await start(t, {
    config: { gateway_ip: gateway.ip },
    receiverUrl: `http://127.0.0.1:${await freePort()}`,
  });

  gateway.up = false;
  await assert.rejects(gladys.handlers.poll({ external_id: 'x' }));

  // Gladys redémarre : `connected` ne doit pas annoncer un statut vrai alors
  // que la passerelle est toujours injoignable.
  await gladys.handlers.events.connected();
  assert.equal(lastStatus(gladys).connected, false);
});
