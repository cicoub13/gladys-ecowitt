import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLocalBattery, readPushBattery } from '../src/ecowitt/battery.js';

test('push : les capteurs à drapeau donnent un état « batterie faible »', () => {
  assert.deepEqual(readPushBattery('wh65batt', '0'), { kind: 'low', low: false });
  assert.deepEqual(readPushBattery('wh65batt', '1'), { kind: 'low', low: true });
  assert.deepEqual(readPushBattery('wh25batt', '1'), { kind: 'low', low: true });
  // WH31, canaux 1 à 8.
  assert.deepEqual(readPushBattery('batt3', '0'), { kind: 'low', low: false });
});

test('push : les niveaux 0-5 donnent des paliers de 20 %', () => {
  assert.deepEqual(readPushBattery('wh57batt', '0'), { kind: 'percent', percent: 0 });
  assert.deepEqual(readPushBattery('wh57batt', '3'), { kind: 'percent', percent: 60 });
  assert.deepEqual(readPushBattery('pm25batt1', '5'), { kind: 'percent', percent: 100 });
  assert.deepEqual(readPushBattery('leakbatt2', '5'), { kind: 'percent', percent: 100 });
  assert.deepEqual(readPushBattery('co2_batt', '4'), { kind: 'percent', percent: 80 });
  // 6 signale une alimentation secteur : plafonné à 100 %.
  assert.deepEqual(readPushBattery('wh57batt', '6'), { kind: 'percent', percent: 100 });
});

test('push : les tensions sont comparées au seuil officiel de 1,2 V', () => {
  assert.deepEqual(readPushBattery('soilbatt1', '1.5'), { kind: 'low', low: false });
  assert.deepEqual(readPushBattery('soilbatt1', '1.2'), { kind: 'low', low: true });
  assert.deepEqual(readPushBattery('soilbatt1', '1.1'), { kind: 'low', low: true });
  assert.deepEqual(readPushBattery('tf_batt2', '1.3'), { kind: 'low', low: false });
});

test('push : pas de seuil inventé pour les capteurs solaires', () => {
  // Ecowitt publie la tension sans documenter de seuil : on n’affiche rien
  // plutôt qu’un état faux.
  assert.equal(readPushBattery('wh80batt', '2.6'), null);
  assert.equal(readPushBattery('wh90batt', '3.1'), null);
  assert.equal(readPushBattery('ws90cap_volt', '5.2'), null);
});

test('push : une clé inconnue ou illisible ne produit rien', () => {
  assert.equal(readPushBattery('unknownbatt', '1'), null);
  assert.equal(readPushBattery('wh65batt', 'abc'), null);
});

test('local : le même WH51 est un drapeau, alors qu’il est en volts côté push', () => {
  // C’est exactement le piège que les deux tables évitent.
  assert.deepEqual(readLocalBattery('wh51', '1'), { kind: 'low', low: true });
  assert.deepEqual(readLocalBattery('wh51', '0'), { kind: 'low', low: false });
  assert.deepEqual(readPushBattery('soilbatt1', '1.5'), { kind: 'low', low: false });
});

test('local : les tensions brutes se multiplient par 0,02 V', () => {
  // 70 × 0,02 = 1,4 V -> au-dessus du seuil.
  assert.deepEqual(readLocalBattery('wh68', '70'), { kind: 'low', low: false });
  // 60 × 0,02 = 1,2 V -> seuil atteint.
  assert.deepEqual(readLocalBattery('wh68', '60'), { kind: 'low', low: true });
  assert.deepEqual(readLocalBattery('wh34', '50'), { kind: 'low', low: true });
});

test('local : niveaux 0-5 et capteurs absents', () => {
  assert.deepEqual(readLocalBattery('wh41', '5'), { kind: 'percent', percent: 100 });
  assert.deepEqual(readLocalBattery('wh45', '2'), { kind: 'percent', percent: 40 });
  // « 9 » accompagne un capteur non appairé.
  assert.equal(readLocalBattery('wh41', '9'), null);
  assert.equal(readLocalBattery('inconnu', '3'), null);
});
