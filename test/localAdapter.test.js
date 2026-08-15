import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObservation, createLocalClient } from '../src/sources/localAdapter.js';
import { LIVEDATA_IMPERIAL, SENSORS_INFO } from './fixtures/livedata.js';

const observation = buildObservation(LIVEDATA_IMPERIAL, SENSORS_INFO);
const find = (type, channel = null) =>
  observation.sensors.find((s) => s.type === type && s.channel === channel);

test('console : bloc wh25 converti en métrique', () => {
  const gateway = find('gateway');
  assert.equal(gateway.values.temperature, 24);
  assert.equal(gateway.values.humidity, 45);
  assert.equal(gateway.values.pressureRelative, 1013.21);
  assert.equal(gateway.values.pressureAbsolute, 998.98);
});

test('station extérieure : identifiants hexadécimaux de common_list', () => {
  const outdoor = find('outdoor');
  assert.equal(outdoor.values.temperature, 20);
  assert.equal(outdoor.values.humidity, 60);
  assert.equal(outdoor.values.dewPoint, 12);
  assert.equal(outdoor.values.windSpeed, 16.09);
  assert.equal(outdoor.values.windGustMaxDaily, 33.8);
  assert.equal(outdoor.values.windDirection, 180);
  assert.equal(outdoor.values.uvIndex, 4);
  assert.equal(outdoor.values.solarRadiation, 63350);
  // Le « ressenti » (id « 3 ») n'est pas exposé : il ne doit rien produire.
  assert.equal(Object.keys(outdoor.values).length, 9);
});

test('les mesures suivent l’unité annoncée, pas une unité supposée', () => {
  const metric = buildObservation({
    wh25: [{ intemp: '24.0', unit: 'C', inhumi: '45%', abs: '999.0 hPa', rel: '1013.2 hPa' }],
  });
  const gateway = metric.sensors.find((s) => s.type === 'gateway');
  assert.equal(gateway.values.temperature, 24, 'une valeur en °C ne doit pas être reconvertie');
  assert.equal(gateway.values.pressureRelative, 1013.2);
});

test('capteurs multi-canaux et valeurs « None »', () => {
  assert.equal(find('wh31', 1).values.temperature, 21.11);
  assert.equal(find('wh31', 1).values.humidity, 55);
  // « None » signifie « pas de mesure », et non zéro.
  assert.equal(find('wh31', 2).values.humidity, undefined);
  assert.equal(find('wh31', 2).values.temperature, 18);
  assert.equal(find('wh51', 1).values.soilMoisture, 45);
  assert.equal(find('wh55', 1).values.leak, 0, '« Normal » vaut absence de fuite');
});

test('l’identifiant matériel provient de get_sensors_info', () => {
  assert.equal(find('outdoor').hardwareId, 'CC44');
  assert.equal(find('wh31', 1).hardwareId, 'A1B2');
  assert.equal(find('wh31', 2).hardwareId, 'A1B3');
  assert.equal(find('wh51', 1).hardwareId, 'D8174');
});

test('le signal 0-4 est exposé en pourcentage', () => {
  assert.equal(find('outdoor').signal, 100);
  assert.equal(find('wh31', 2).signal, 50);
});

test('un capteur non appairé est ignoré', () => {
  assert.equal(find('wh41', 1), undefined);
  assert.ok(
    observation.sensors.every((s) => s.hardwareId !== 'FFFFFFFF'),
    'aucun capteur ne doit porter l’identifiant des capteurs absents',
  );
});

test('les batteries suivent la convention de l’API locale', () => {
  // WH31 : drapeau, contrairement au protocole push.
  assert.deepEqual(find('wh31', 2).battery, { kind: 'low', low: true });
  // WH57 : niveau 0-5.
  assert.deepEqual(find('wh57').battery, { kind: 'percent', percent: 80 });
});

test('le pluviomètre piézoélectrique prime sur l’auget', () => {
  const withPiezo = buildObservation({
    rain: [{ id: '0x10', val: '1.00 in' }],
    piezoRain: [{ id: '0x10', val: '2.00 in' }],
  });
  const rain = withPiezo.sensors.find((s) => s.type === 'rain');
  assert.equal(rain.values.rainDaily, 50.8);
});

test('le client mutualise les appels concurrents et met en cache', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const body = url.includes('sensors') ? SENSORS_INFO : LIVEDATA_IMPERIAL;
    return { ok: true, json: async () => body };
  };
  const client = createLocalClient({ ip: '192.168.1.50', fetchImpl, cacheMs: 10_000 });

  // Dix devices interrogés en même temps ne doivent pas produire dix requêtes.
  await Promise.all(Array.from({ length: 10 }, () => client.getObservation()));
  assert.equal(calls, 2, 'un seul aller-retour par point d’entrée');

  await client.getObservation();
  assert.equal(calls, 2, 'la réponse suivante vient du cache');

  client.invalidate();
  await client.getObservation();
  assert.equal(calls, 4, 'après invalidation, la passerelle est réinterrogée');
});

test('l’absence de get_sensors_info ne prive pas des mesures', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('sensors')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, json: async () => LIVEDATA_IMPERIAL };
  };
  const client = createLocalClient({ ip: '192.168.1.50', fetchImpl });
  const result = await client.getObservation();
  assert.ok(result.sensors.length > 0);
  assert.equal(result.sensors.find((s) => s.type === 'outdoor').hardwareId, null);
});
