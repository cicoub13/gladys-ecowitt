import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startIntegration } from '../src/integration.js';
import { startReceiver } from '../src/receiver/server.js';
import { createStore } from '../src/store.js';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
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

/**
 * Démarre l'intégration contre le faux Gladys du SDK, et l'arrête en fin de
 * test. `startIntegration` se connecte : le handler `connected` a tourné au
 * retour.
 */
async function start(t, { config, receiverUrl }) {
  const gladys = createFakeGladys({ selector: 'ecowitt', config });
  await startIntegration({ gladys, store: newStore(), receiverUrl });
  t.after(() => gladys.fake.shutdown());
  return gladys;
}

const lastStatus = (gladys) => gladys.fake.connectionStatus;

/** États publiés pour une fonctionnalité de la console (`gateway`). */
const gatewayStates = (gladys, key) =>
  gladys.fake.states.filter(
    (s) =>
      s.device_feature_external_id.startsWith('ext:ecowitt:gateway:') &&
      s.device_feature_external_id.endsWith(`:${key}`),
  );

/** Dernière humidité intérieure publiée : elle identifie la lecture (40 + n). */
const indoorHumidity = (gladys) => gatewayStates(gladys, 'humidity').at(-1)?.state;

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
  assert.ok(gladys.fake.discoveredDevices.length > 1);

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
  await gladys.fake.configUpdated({ gateway_ip: gateway.ip, poll_frequency: 30 });
  assert.ok(await readPublished(gladys, 2));
  t.mock.timers.tick(30_000);
  assert.ok(await readPublished(gladys, 3));
  t.mock.timers.tick(30_000);
  assert.ok(await readPublished(gladys, 4));
  await settle();
  assert.equal(gateway.reads, 4, 'l’ancien minuteur de 60 s ne tourne plus');

  // Passage en push : plus aucune lecture.
  await gladys.fake.configUpdated({ mode: 'push', gateway_ip: gateway.ip });
  t.mock.timers.tick(60_000);
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(gateway.reads, 4);

  // Retour en automatique avec une IP : la boucle repart.
  await gladys.fake.configUpdated({ gateway_ip: gateway.ip });
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
  const count = gladys.fake.connectionStatuses.length;
  t.mock.timers.tick(30_000);
  assert.ok(await waitFor(() => gateway.reads === 3));
  await settle();
  assert.equal(gladys.fake.connectionStatuses.length, count);

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

  await gladys.disconnect();
  t.mock.timers.tick(30_000);
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(gateway.reads, 1);

  await gladys.connect();
  assert.ok(await readPublished(gladys, 2));
  t.mock.timers.tick(30_000);
  assert.ok(await readPublished(gladys, 3));

  await gladys.fake.shutdown();
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
  await gladys.disconnect();
  await gladys.connect();
  assert.equal(lastStatus(gladys).connected, false);
});

test('un appareil créé reçoit toutes ses valeurs au relevé suivant, même celles qui ne bougent pas', async (t) => {
  mockTimers(t);
  const gateway = await startFakeGateway(t);
  const gladys = await start(t, {
    config: { gateway_ip: gateway.ip, poll_frequency: 30 },
    receiverUrl: `http://127.0.0.1:${await freePort()}`,
  });
  // Premier relevé publié avant que l'utilisateur ne crée l'appareil : Gladys
  // l'ignore.
  assert.ok(await readPublished(gladys, 1));
  assert.equal(gatewayStates(gladys, 'temperature').length, 1);

  t.mock.timers.tick(30_000);
  assert.ok(await readPublished(gladys, 2));
  assert.equal(gatewayStates(gladys, 'temperature').length, 1, 'valeur inchangée : pas renvoyée');

  const gatewayDevice = gladys.fake.discoveredDevices.find((device) =>
    device.external_id.startsWith('ext:ecowitt:gateway:'),
  );
  await gladys.fake.deviceCreated(gatewayDevice);
  t.mock.timers.tick(30_000);
  assert.ok(await readPublished(gladys, 3));
  assert.equal(
    gatewayStates(gladys, 'temperature').length,
    2,
    'la température, inchangée, est renvoyée une fois l’appareil créé',
  );
});
