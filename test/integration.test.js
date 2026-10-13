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

// `performance.now()` et non `Date.now()` : certains tests simulent `Date`.
const waitFor = async (predicate, timeoutMs = 5_000) => {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
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

/**
 * Passerelle simulée, que le test peut « éteindre » et « rallumer ». Elle
 * compte ses lectures (`reads`) et renvoie à chacune une humidité intérieure
 * différente (40 % + numéro de lecture), pour que chaque lecture publie un
 * état neuf malgré la déduplication de `publishChangedStates`.
 */
async function startFakeGateway(t) {
  const gateway = { up: true, reads: 0 };
  const server = http.createServer((req, res) => {
    if (req.url === '/get_livedata_info') {
      gateway.reads += 1;
    }
    if (!gateway.up) {
      req.socket.destroy(); // passerelle éteinte : la connexion tombe
      return;
    }
    const body =
      req.url === '/get_sensors_info'
        ? SENSORS_INFO
        : {
            ...LIVEDATA_IMPERIAL,
            wh25: [{ ...LIVEDATA_IMPERIAL.wh25[0], inhumi: `${40 + gateway.reads}%` }],
          };
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

/** Dernière humidité intérieure publiée : elle identifie la lecture (40 + n). */
const indoorHumidity = (gladys) =>
  gladys.published.filter((p) => /^gateway:.*:humidity$/.test(p.featureExternalId)).at(-1)?.state;

/** Attend que la n-ième lecture de la passerelle soit publiée. */
const readPublished = (gladys, n) => waitFor(() => indoorHumidity(gladys) === 40 + n);

/** Laisse aboutir ce qui est en cours (ex. une lecture en échec, invisible). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/**
 * Seuls `setInterval` (la boucle) et `Date` (le cache de 10 s du client local)
 * sont simulés : le réseau et `setTimeout` restent réels.
 */
const mockTimers = (t) => t.mock.timers.enable({ apis: ['setInterval', 'Date'] });

test('mode local : une seule lecture de la passerelle par intervalle, quel que soit le nombre d’appareils', async (t) => {
  mockTimers(t);
  const gateway = await startFakeGateway(t);
  const gladys = await start(t, {
    config: { gateway_ip: gateway.ip, poll_frequency: 30 },
    receiverUrl: `http://127.0.0.1:${await freePort()}`,
  });

  assert.ok(await readPublished(gladys, 1), 'une lecture dès la connexion');
  assert.ok(gladys.discovered.length > 1);

  t.mock.timers.tick(29_999);
  await settle();
  assert.equal(gateway.reads, 1);

  t.mock.timers.tick(1);
  assert.ok(await readPublished(gladys, 2), 'les relevés sont rafraîchis à chaque intervalle');
  t.mock.timers.tick(30_000);
  assert.ok(await readPublished(gladys, 3));
  await settle();
  assert.equal(gateway.reads, 3);
});

test('mode push : la passerelle n’est jamais lue', async (t) => {
  mockTimers(t);
  const gateway = await startFakeGateway(t);
  await start(t, {
    config: { mode: 'push', gateway_ip: gateway.ip },
    receiverUrl: `http://127.0.0.1:${await freePort()}`,
  });

  t.mock.timers.tick(60_000);
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(gateway.reads, 0);
});

test('un changement de configuration réarme la boucle, y compris de mode', async (t) => {
  mockTimers(t);
  const gateway = await startFakeGateway(t);
  const gladys = await start(t, {
    config: { gateway_ip: gateway.ip, poll_frequency: 60 },
    receiverUrl: `http://127.0.0.1:${await freePort()}`,
  });
  assert.ok(await readPublished(gladys, 1));

  // Nouvel intervalle : lecture immédiate, puis toutes les 30 s.
  await gladys.handlers.configUpdated({ gateway_ip: gateway.ip, poll_frequency: 30 });
  assert.ok(await readPublished(gladys, 2));
  t.mock.timers.tick(30_000);
  assert.ok(await readPublished(gladys, 3));
  t.mock.timers.tick(30_000);
  assert.ok(await readPublished(gladys, 4));
  await settle();
  assert.equal(gateway.reads, 4, 'l’ancien minuteur de 60 s ne tourne plus');

  // Passage en push : plus aucune lecture.
  await gladys.handlers.configUpdated({ mode: 'push', gateway_ip: gateway.ip });
  t.mock.timers.tick(60_000);
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(gateway.reads, 4);

  // Retour en automatique avec une IP : la boucle repart.
  await gladys.handlers.configUpdated({ gateway_ip: gateway.ip });
  assert.ok(await readPublished(gladys, 5));
});

test('mode local : une lecture en échec passe le statut à faux sans arrêter la boucle', async (t) => {
  mockTimers(t);
  const gateway = await startFakeGateway(t);
  const gladys = await start(t, {
    config: { gateway_ip: gateway.ip, poll_frequency: 30 },
    receiverUrl: `http://127.0.0.1:${await freePort()}`,
  });
  assert.ok(await readPublished(gladys, 1));
  assert.equal(lastStatus(gladys).connected, true);

  gateway.up = false;
  t.mock.timers.tick(30_000);
  assert.ok(await waitFor(() => lastStatus(gladys).connected === false));
  assert.match(lastStatus(gladys).message.en, new RegExp(gateway.ip.replace('.', '\\.')));
  assert.ok(lastStatus(gladys).message.fr);

  // Un second échec ne renvoie pas le même statut.
  const count = gladys.connectionStatuses.length;
  t.mock.timers.tick(30_000);
  assert.ok(await waitFor(() => gateway.reads === 3));
  await settle();
  assert.equal(gladys.connectionStatuses.length, count);

  gateway.up = true;
  t.mock.timers.tick(30_000);
  assert.ok(await readPublished(gladys, 4), 'les états sont republiés au retour');
  assert.equal(lastStatus(gladys).connected, true);
});

test('la boucle s’arrête à la déconnexion et à l’arrêt, et repart à la reconnexion', async (t) => {
  mockTimers(t);
  const gateway = await startFakeGateway(t);
  const gladys = await start(t, {
    config: { gateway_ip: gateway.ip, poll_frequency: 30 },
    receiverUrl: `http://127.0.0.1:${await freePort()}`,
  });
  assert.ok(await readPublished(gladys, 1));

  gladys.handlers.events.disconnected();
  t.mock.timers.tick(30_000);
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(gateway.reads, 1);

  await gladys.handlers.events.connected();
  assert.ok(await readPublished(gladys, 2));
  t.mock.timers.tick(30_000);
  assert.ok(await readPublished(gladys, 3));

  await gladys.handlers.shutdown();
  t.mock.timers.tick(30_000);
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(gateway.reads, 3);
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
  mockTimers(t);
  const gateway = await startFakeGateway(t);
  const gladys = await start(t, {
    config: { gateway_ip: gateway.ip, poll_frequency: 30 },
    receiverUrl: `http://127.0.0.1:${await freePort()}`,
  });
  assert.ok(await readPublished(gladys, 1));

  gateway.up = false;
  t.mock.timers.tick(30_000);
  assert.ok(await waitFor(() => lastStatus(gladys).connected === false));

  // Gladys redémarre : `connected` ne doit pas annoncer un statut vrai alors
  // que la passerelle est toujours injoignable.
  await gladys.handlers.events.connected();
  assert.equal(lastStatus(gladys).connected, false);
});
