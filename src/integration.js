// -----------------------------------------------------------------------------
// Câblage du SDK Gladys.
//
// Ce module ne contient aucune connaissance du protocole Ecowitt : il orchestre
// les sources (receiver en mode push, API locale en mode polling), l'état
// accumulé et la publication. Les handlers sont enregistrés AVANT `connect()`,
// comme l'impose le SDK.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { MODES, normalizeConfig, resolveMode } from './config.js';
import { createStore } from './store.js';
import { createPublisher } from './gladys/publisher.js';
import { buildDiscoveredDevices, buildStates } from './gladys/buildDevices.js';
import { createReceiverClient } from './receiver/client.js';
import { createLocalClient } from './sources/localAdapter.js';
import { toObservation } from './sources/pushAdapter.js';
import { toEcowittPayload } from './sources/wunderground.js';
import { scanGateways } from './discovery.js';

/**
 * Adresse du sous-conteneur sur le réseau privé : son alias DNS est son nom.
 * Port INTERNE, jamais publié sur le LAN (voir src/receiver/server.js).
 */
const RECEIVER_URL = process.env.ECOWITT_RECEIVER_URL ?? 'http://receiver:8081';

export async function startIntegration() {
  const gladys = new GladysIntegration();
  const store = createStore();
  const publisher = createPublisher(gladys);

  let config = normalizeConfig();
  let localClient = null;

  await store.load();

  const receiver = createReceiverClient({
    baseUrl: RECEIVER_URL,
    onReading: (reading) => handleReading(reading),
  });

  // --- Traitement d'un relevé reçu en push ---------------------------------
  async function handleReading(reading) {
    const payload =
      reading.protocol === 'wunderground' ? toEcowittPayload(reading.payload) : reading.payload;

    // Le port du receiver est ouvert sur le LAN : si l'utilisateur a désigné
    // une station, on ignore tout ce qui vient d'ailleurs.
    if (config.station_passkey && payload.PASSKEY !== config.station_passkey) {
      logger.warn(`Relevé ignoré : PASSKEY inattendu (${payload.PASSKEY ?? 'absent'})`);
      return;
    }
    if (resolveMode(config) !== MODES.PUSH) {
      return; // le mode polling fait autorité, on ne mélange pas les sources
    }
    await ingest(toObservation(payload));
  }

  /** Chemin commun aux deux sources : mémoriser, publier, republier si besoin. */
  async function ingest(observation) {
    const profileChanged = store.merge(observation);
    store.scheduleSave();

    if (profileChanged) {
      logger.info('Nouveau profil de capteurs, republication des appareils découverts');
      await publishDevices();
    }
    await publisher.publish(buildStates(gladys, store.state.stationId, observation));
  }

  async function publishDevices() {
    const pollFrequency = resolveMode(config) === MODES.LOCAL ? config.poll_frequency : undefined;
    await gladys.publishDiscoveredDevices(
      buildDiscoveredDevices(gladys, store.state, { pollFrequency }),
    );
  }

  function refreshLocalClient() {
    localClient = null;
    if (resolveMode(config) === MODES.LOCAL && config.gateway_ip) {
      localClient = createLocalClient({ ip: config.gateway_ip });
    }
  }

  // --- Handlers -------------------------------------------------------------

  gladys.onScanRequest(async () => {
    if (resolveMode(config) === MODES.LOCAL && localClient) {
      await ingest(await localClient.getObservation());
    }
    await publishDevices();
  });

  gladys.onPoll(async () => {
    if (!localClient) {
      return; // en mode push, c'est la station qui donne le rythme
    }
    await ingest(await localClient.getObservation());
  });

  gladys.onConfigUpdated(async (raw) => {
    config = normalizeConfig(raw);
    refreshLocalClient();
    await publishDevices();
  });

  gladys.onAction('test_reception', async () => {
    const mode = resolveMode(config);
    if (mode === MODES.LOCAL) {
      const observation = await localClient.getObservation();
      return {
        fr: `Passerelle ${config.gateway_ip} joignable : ${observation.sensors.length} capteur(s) détecté(s).`,
        en: `Gateway ${config.gateway_ip} reachable: ${observation.sensors.length} sensor(s) detected.`,
      };
    }
    const status = await receiver.status();
    if (!status.last) {
      return {
        fr: "Aucun relevé reçu pour l'instant. Vérifiez l'adresse, le port et le chemin saisis dans WS View Plus : l'adresse doit être l'IP locale de la machine qui héberge Gladys, jamais localhost.",
        en: 'No reading received yet. Check the address, port and path set in WS View Plus: the address must be the local IP of the machine running Gladys, never localhost.',
      };
    }
    const sensorCount = Object.keys(store.state.sensors).length;
    return {
      fr: `${status.receivedCount} relevé(s) reçu(s), dernier le ${status.last.receivedAt} (protocole ${status.last.protocol}), ${sensorCount} capteur(s) détecté(s).`,
      en: `${status.receivedCount} reading(s) received, last at ${status.last.receivedAt} (${status.last.protocol} protocol), ${sensorCount} sensor(s) detected.`,
    };
  });

  gladys.onAction('scan_gateways', async () => {
    const gateways = await scanGateways(gladys);
    if (gateways.length === 0) {
      return {
        fr: 'Aucune passerelle détectée. Les consoles sans API locale (WS2910, GW1000...) ne répondent pas à ce scan : utilisez le mode réception.',
        en: 'No gateway found. Consoles without a local API (WS2910, GW1000...) do not answer this scan: use the push mode.',
      };
    }
    const list = gateways.map((gateway) => `${gateway.name} (${gateway.ip})`).join(', ');
    return { fr: `Passerelle(s) détectée(s) : ${list}`, en: `Gateway(s) found: ${list}` };
  });

  // --- Cycle de vie ---------------------------------------------------------

  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      refreshLocalClient();
      // Gladys resynchronise son état à chaque reconnexion : les valeurs
      // mémorisées ne sont plus un reflet fiable de ce qu'il connaît.
      publisher.reset();
      await publishDevices();
      await gladys.setConnectionStatus(true);
    } catch (err) {
      logger.error('Initialisation impossible après connexion', err);
      await gladys
        .setConnectionStatus(false, {
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
          en: 'Initialization failed, check the integration logs.',
        })
        .catch(() => {});
    }
  });

  gladys.handleShutdown(async () => {
    receiver.stop();
    await store.save().catch(() => {});
  });

  receiver.start();
  await gladys.connect();
  return gladys;
}
