import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toObservation } from '../src/sources/pushAdapter.js';
import { WS2910_PAYLOAD } from './fixtures/ws2910.js';

const observation = toObservation(WS2910_PAYLOAD);
const find = (type, channel = null) =>
  observation.sensors.find((s) => s.type === type && s.channel === channel);

test('identifie la station par son PASSKEY', () => {
  assert.equal(observation.stationId, WS2910_PAYLOAD.PASSKEY);
  assert.equal(observation.model, 'WS2910_V2.2.4');
});

test('console : température, humidité et les deux pressions', () => {
  const gateway = find('gateway');
  assert.equal(gateway.values.temperature, 24);
  assert.equal(gateway.values.humidity, 45);
  assert.equal(gateway.values.pressureRelative, 1013.21);
  assert.equal(gateway.values.pressureAbsolute, 998.98);
  assert.deepEqual(gateway.battery, { kind: 'low', low: false });
});

test('station extérieure : vent en km/h et ensoleillement en lux', () => {
  const outdoor = find('outdoor');
  assert.equal(outdoor.values.temperature, 20);
  assert.equal(outdoor.values.humidity, 60);
  assert.equal(outdoor.values.windSpeed, 16.09);
  assert.equal(outdoor.values.windGust, 24.14);
  assert.equal(outdoor.values.windGustMaxDaily, 33.8);
  assert.equal(outdoor.values.windDirection, 180);
  assert.equal(outdoor.values.uvIndex, 4);
  assert.equal(outdoor.values.solarRadiation, 63350);
});

test('pluviomètre : cumuls convertis en millimètres', () => {
  const rain = find('rain');
  assert.equal(rain.values.rainRate, 0.51);
  assert.equal(rain.values.rainDaily, 2.54);
  assert.equal(rain.values.rainYearly, 508);
  // Aucune batterie WH40 dans ce payload : la pluie vient de la station.
  assert.equal(rain.battery, null);
});

test('un capteur par canal, uniquement pour les canaux présents', () => {
  assert.equal(find('wh31', 1).values.temperature, 21.11);
  assert.equal(find('wh31', 1).values.humidity, 55);
  assert.deepEqual(find('wh31', 2).battery, { kind: 'low', low: true });
  assert.equal(find('wh31', 3), undefined, 'un canal absent ne crée pas de capteur');
  assert.equal(find('wh51', 1).values.soilMoisture, 45);
  assert.equal(find('wh41', 1).values.pm25Avg24h, 12.5);
  assert.equal(find('wh55', 1).values.leak, 0);
});

test('foudre : distance déjà en kilomètres, batterie en niveau', () => {
  const lightning = find('wh57');
  assert.equal(lightning.values.lightningCount, 3);
  assert.equal(lightning.values.lightningDistance, 12);
  assert.deepEqual(lightning.battery, { kind: 'percent', percent: 80 });
});

test('un payload vide ne produit aucun capteur', () => {
  const empty = toObservation({ PASSKEY: 'ABC' });
  assert.equal(empty.sensors.length, 0);
  assert.equal(empty.stationId, 'ABC');
});

test('le pluviomètre piézoélectrique prend le pas sur l’auget', () => {
  const withPiezo = toObservation({
    PASSKEY: 'ABC',
    dailyrainin: '1.000',
    drain_piezo: '2.000',
  });
  const rain = withPiezo.sensors.find((s) => s.type === 'rain');
  assert.equal(rain.values.rainDaily, 50.8, 'la mesure piézo (2 in) doit gagner');
});
