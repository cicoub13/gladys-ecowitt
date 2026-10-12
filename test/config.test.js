import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';

test('l’intervalle de polling est ramené aux valeurs que Gladys accepte', () => {
  assert.equal(normalizeConfig({ poll_frequency: 30 }).poll_frequency, 30);
  assert.equal(normalizeConfig({ poll_frequency: 60 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: '30' }).poll_frequency, 30);
  // Valeurs saisies avant la correction (le champ allait jusqu'à 3600 s).
  assert.equal(normalizeConfig({ poll_frequency: 120 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 3600 }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 10 }).poll_frequency, 30);
  // À égale distance, le plus lent : moins de requêtes à la passerelle.
  assert.equal(normalizeConfig({ poll_frequency: 45 }).poll_frequency, 60);
  // Valeur absente ou illisible : la valeur par défaut, jamais NaN.
  assert.equal(normalizeConfig({}).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: null }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: '' }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 60);
  assert.equal(normalizeConfig({ poll_frequency: true }).poll_frequency, 60);
});
