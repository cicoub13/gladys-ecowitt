import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDiscoveredDevices, buildStates, platformId } from '../src/gladys/buildDevices.js';
import { createPublisher } from '../src/gladys/publisher.js';
import { createStore } from '../src/store.js';
import { toObservation } from '../src/sources/pushAdapter.js';
import { buildObservation } from '../src/sources/localAdapter.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { WS2910_PAYLOAD } from './fixtures/ws2910.js';
import { LIVEDATA_IMPERIAL, SENSORS_INFO } from './fixtures/livedata.js';

const newStore = () =>
  createStore({ path: join(tmpdir(), `ecowitt-test-${Math.random().toString(36).slice(2)}.json`) });

test('un device par capteur physique, nommé par canal', () => {
  const gladys = createFakeGladys();
  const store = newStore();
  store.merge(toObservation(WS2910_PAYLOAD));

  const devices = buildDiscoveredDevices(gladys, store.state);
  const names = devices.map((d) => d.name);

  assert.ok(names.includes('Console Ecowitt'));
  assert.ok(names.includes('Station extérieure'));
  assert.ok(names.includes('Pluviomètre'));
  assert.ok(names.includes('Capteur temp./hum. 1'));
  assert.ok(names.includes('Capteur temp./hum. 2'));
  assert.ok(names.includes('Humidité du sol 1'));
  assert.ok(names.includes('Détecteur de foudre'));
});

test('seules les mesures réellement observées deviennent des fonctionnalités', () => {
  const gladys = createFakeGladys();
  const store = newStore();
  store.merge(toObservation(WS2910_PAYLOAD));

  const outdoor = buildDiscoveredDevices(gladys, store.state).find(
    (d) => d.name === 'Station extérieure',
  );
  const keys = outdoor.features.map((f) => f.external_id.split(':').pop());

  assert.ok(keys.includes('windSpeed'));
  assert.ok(keys.includes('solarRadiation'));
  // Le protocole push ne transporte pas le point de rosée : pas de
  // fonctionnalité vide dans Gladys.
  assert.ok(!keys.includes('dewPoint'));
});

test('la structure d’un device reste stable quand une mesure manque', () => {
  const gladys = createFakeGladys();
  const store = newStore();

  store.merge(toObservation(WS2910_PAYLOAD));
  const before = buildDiscoveredDevices(gladys, store.state).find(
    (d) => d.name === 'Station extérieure',
  ).features.length;

  // Envoi suivant sans la rafale maximale (remise à zéro à minuit).
  const partial = { ...WS2910_PAYLOAD };
  delete partial.maxdailygust;
  const changed = store.merge(toObservation(partial));

  const after = buildDiscoveredDevices(gladys, store.state).find(
    (d) => d.name === 'Station extérieure',
  ).features.length;

  assert.equal(after, before, 'une mesure absente ne doit pas retirer la fonctionnalité');
  assert.equal(changed, false, 'et ne doit pas déclencher de republication');
});

test('un nouveau capteur déclenche une republication', () => {
  const store = newStore();
  store.merge(toObservation(WS2910_PAYLOAD));
  const changed = store.merge(toObservation({ ...WS2910_PAYLOAD, soilmoisture2: '30' }));
  assert.equal(changed, true);
});

test('la batterie choisit sa forme selon ce que publie le capteur', () => {
  const gladys = createFakeGladys();
  const store = newStore();
  store.merge(toObservation(WS2910_PAYLOAD));
  const devices = buildDiscoveredDevices(gladys, store.state);

  const categoriesOf = (name) =>
    devices.find((d) => d.name === name).features.map((f) => f.category);

  // WH31 : drapeau 0/1 -> batterie faible.
  assert.ok(categoriesOf('Capteur temp./hum. 1').includes('battery-low'));
  // WH57 : niveau 0-5 -> pourcentage.
  assert.ok(categoriesOf('Détecteur de foudre').includes('battery'));
  // WH51 en push : tension, seuil documenté -> batterie faible, jamais un
  // pourcentage extrapolé.
  const soil = categoriesOf('Humidité du sol 1');
  assert.ok(soil.includes('battery-low'));
  assert.ok(!soil.includes('battery'));
});

test('l’identifiant matériel sert d’ancrage quand il est disponible', () => {
  // Mode API locale : l'identifiant survit à un changement de canal.
  const local = buildObservation(LIVEDATA_IMPERIAL, SENSORS_INFO);
  const wh31 = local.sensors.find((s) => s.type === 'wh31' && s.channel === 1);
  assert.equal(platformId('CC44', wh31), 'wh31-A1B2');

  // Mode push : pas d'identifiant matériel, on retombe sur station+type+canal.
  const push = toObservation(WS2910_PAYLOAD);
  const pushed = push.sensors.find((s) => s.type === 'wh31' && s.channel === 1);
  assert.equal(platformId('ABC', pushed), 'ABC-wh31:1');
});

test('les états sont aplatis, batterie et signal compris', () => {
  const gladys = createFakeGladys();
  const observation = buildObservation(LIVEDATA_IMPERIAL, SENSORS_INFO);
  const states = buildStates(gladys, 'CC44', observation);

  const byId = new Map(states.map((s) => [s.device_feature_external_id, s.state]));
  assert.equal(byId.get('wh31:wh31-A1B2:temperature'), 21.11);
  assert.equal(byId.get('wh31:wh31-A1B2:signal'), 100);
  // Batterie faible du canal 2, exprimée en binaire.
  assert.equal(byId.get('wh31:wh31-A1B3:batteryLow'), 1);
});

test('le publisher ne renvoie que ce qui a changé', async () => {
  const gladys = createFakeGladys();
  const publisher = createPublisher(gladys);
  const states = [
    { device_feature_external_id: 'a', state: 1 },
    { device_feature_external_id: 'b', state: 2 },
  ];

  assert.equal(await publisher.publish(states), 2);
  assert.equal(await publisher.publish(states), 0, 'des valeurs identiques ne repartent pas');

  assert.equal(
    await publisher.publish([
      { device_feature_external_id: 'a', state: 1 },
      { device_feature_external_id: 'b', state: 3 },
    ]),
    1,
  );
  assert.equal(gladys.published.length, 3);

  // À la reconnexion, Gladys resynchronise : tout doit être republié.
  publisher.reset();
  assert.equal(await publisher.publish(states), 2);
});

test('le publisher découpe en lots de 100', async () => {
  const batches = [];
  const gladys = {
    ...createFakeGladys(),
    async publishStates(list) {
      batches.push(list.length);
    },
  };
  const publisher = createPublisher(gladys);
  const many = Array.from({ length: 250 }, (_, index) => ({
    device_feature_external_id: `feature-${index}`,
    state: index,
  }));

  await publisher.publish(many);
  assert.deepEqual(batches, [100, 100, 50]);
});

test('l’état se recharge depuis le disque', async () => {
  const path = join(tmpdir(), `ecowitt-persist-${Math.random().toString(36).slice(2)}.json`);
  const store = createStore({ path });
  store.merge(toObservation(WS2910_PAYLOAD));
  await store.save();

  const reloaded = createStore({ path });
  await reloaded.load();
  assert.equal(
    Object.keys(reloaded.state.sensors).length,
    Object.keys(store.state.sensors).length,
    'la découverte doit survivre à un redémarrage',
  );
  assert.equal(reloaded.state.stationId, WS2910_PAYLOAD.PASSKEY);
});
