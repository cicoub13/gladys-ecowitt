import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fahrenheitToCelsius,
  inHgToHectoPascal,
  inchToMm,
  mphToKmh,
  parseValueWithUnit,
  readLocalValue,
  readPushValue,
  round,
  toMetric,
} from '../src/ecowitt/units.js';

test('conversions impériales de référence', () => {
  assert.equal(round(fahrenheitToCelsius(32)), 0);
  assert.equal(round(fahrenheitToCelsius(212)), 100);
  assert.equal(round(fahrenheitToCelsius(68)), 20);
  assert.equal(round(inHgToHectoPascal(29.92), 1), 1013.2);
  assert.equal(round(mphToKmh(10), 2), 16.09);
  assert.equal(round(inchToMm(1), 1), 25.4);
});

test('toMetric laisse passer les unités déjà métriques', () => {
  assert.equal(toMetric(21.5, 'C'), 21.5);
  assert.equal(toMetric(1013, 'hPa'), 1013);
  assert.equal(toMetric(60, '%'), 60);
  assert.equal(toMetric(12, 'km/h'), 12);
});

test('toMetric refuse ce qui n’est pas un nombre fini', () => {
  assert.equal(toMetric(Number.NaN, 'F'), null);
  assert.equal(toMetric(Infinity, 'F'), null);
});

test('parseValueWithUnit gère les deux formes de l’API locale', () => {
  // Unité collée à la valeur.
  assert.deepEqual(parseValueWithUnit('0.00 mph'), { value: 0, unit: 'mph' });
  assert.deepEqual(parseValueWithUnit('1.12 in/Hr'), { value: 1.12, unit: 'in/hr' });
  // Unité fournie par le champ `unit` voisin.
  assert.deepEqual(parseValueWithUnit('79.2', 'F'), { value: 79.2, unit: 'f' });
  // Valeurs négatives et pourcentages.
  assert.deepEqual(parseValueWithUnit('-5.4', 'C'), { value: -5.4, unit: 'c' });
  assert.deepEqual(parseValueWithUnit('65%'), { value: 65, unit: '%' });
});

test('parseValueWithUnit renvoie null sur une valeur illisible', () => {
  assert.deepEqual(parseValueWithUnit('None'), { value: null, unit: '' });
  assert.deepEqual(parseValueWithUnit(''), { value: null, unit: '' });
  assert.deepEqual(parseValueWithUnit(undefined), { value: null, unit: '' });
});

test('readLocalValue convertit selon l’unité annoncée, jamais supposée', () => {
  assert.equal(readLocalValue('79.2', 'F', 1), 26.2);
  assert.equal(readLocalValue('26.2', 'C', 1), 26.2);
  assert.equal(readLocalValue('0.00 mph'), 0);
  assert.equal(readLocalValue('10.00 mph', '', 2), 16.09);
  assert.equal(readLocalValue('29.92 inHg', '', 1), 1013.2);
});

test('readPushValue applique l’unité impériale fixe du protocole', () => {
  assert.equal(readPushValue('68.0', 'f', 1), 20);
  assert.equal(readPushValue('60', null), 60);
  assert.equal(readPushValue('', 'f'), null);
  assert.equal(readPushValue('abc', 'f'), null);
});
