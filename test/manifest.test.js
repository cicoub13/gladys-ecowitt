// -----------------------------------------------------------------------------
// Cohérence entre le manifeste et le code.
//
// Le validateur du store vérifie la forme du manifeste ; rien là-bas ne peut
// savoir ce que le code enregistre réellement, ni que nos deux références
// d'image restent alignées. C'est le rôle de ces tests.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { DISCOVERY_PORT } from '../src/discovery.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/** Actions enregistrées dans `src/integration.js`. */
const REGISTERED_ACTIONS = ['test_reception', 'scan_gateways'];

test('chaque action du manifeste a un handler', () => {
  for (const action of manifest.actions ?? []) {
    assert.ok(
      REGISTERED_ACTIONS.includes(action.key),
      `l'action « ${action.key} » n'a pas de handler`,
    );
  }
});

test('les valeurs par défaut restent alignées sur DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} doit valoir la valeur par défaut du manifeste`,
      );
    }
  }
});

test('les sections ne stockent aucune valeur', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(section.label?.en, `la section « ${section.key} » doit avoir un libellé anglais`);
    assert.ok(
      !(section.key in DEFAULT_CONFIG),
      `la section « ${section.key} » ne doit pas apparaître dans DEFAULT_CONFIG`,
    );
  }
});

test('tout placeholder {{port:…}} désigne un port déclaré', () => {
  // Une référence à un port inexistant fait rejeter le manifeste par
  // l'indexeur comme par le serveur.
  const declared = new Set(
    (manifest.containers ?? []).flatMap((container) =>
      (container.ports ?? []).map((port) => port.name).filter(Boolean),
    ),
  );
  const texts = JSON.stringify(manifest);
  for (const [, name] of texts.matchAll(/\{\{port:([a-z0-9_]+)\}\}/g)) {
    assert.ok(declared.has(name), `le placeholder {{port:${name}}} ne correspond à aucun port`);
  }
});

test('le sous-conteneur réutilise exactement l’image de l’intégration', () => {
  // Les deux références doivent être bumpées ensemble à chaque release : le
  // workflow du template ne met à jour que `docker_image` racine, il a été
  // complété pour traiter aussi les sous-conteneurs.
  for (const container of manifest.containers ?? []) {
    assert.equal(
      container.docker_image,
      manifest.docker_image,
      `le conteneur « ${container.name} » doit pointer sur la même image et la même version`,
    );
  }
});

test('la version du manifeste suit celle du package', () => {
  assert.equal(manifest.version, packageJson.version);
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    "le tag de l'image doit correspondre à la version du manifeste",
  );
});

test('la commande du receiver correspond au point d’entrée réel', () => {
  const receiver = manifest.containers.find((container) => container.name === 'receiver');
  assert.deepEqual(receiver.command, ['node', 'index.js', '--receiver']);
  // Le port déclaré est celui qu'écoute le receiver par défaut.
  assert.equal(receiver.ports[0].container_port, 8080);
  // Sans « browsable: false », Gladys proposerait d'ouvrir dans un navigateur
  // un point d'entrée qui n'affiche aucune page.
  assert.equal(receiver.ports[0].browsable, false);
});

test('la découverte réseau déclare le port d’annonce des passerelles', () => {
  const udp = manifest.network_discovery.find((entry) => entry.type === 'udp-broadcast');
  assert.ok(udp, 'la capture udp-broadcast doit être déclarée, sinon le cœur répond 403');
  assert.ok(udp.ports.includes(DISCOVERY_PORT));
});

test('déclarer des categories impose Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  const [, major, minor] = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.\d+/).map(Number);
  assert.ok(major > 4 || (major === 4 && minor >= 86));
});
