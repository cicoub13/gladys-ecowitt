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

/** Statut affiché quand la passerelle interrogée ne répond pas. */
const gatewayUnreachable = (ip) => ({
  fr: `Passerelle injoignable à ${ip} : vérifiez qu'elle est allumée et que son adresse n'a pas changé.`,
  en: `Gateway unreachable at ${ip}: check it is powered on and its address has not changed.`,
});

/** Statut affiché quand le flux du sous-conteneur receiver est coupé. */
const RECEIVER_UNREACHABLE = {
  fr: 'Le récepteur des relevés est injoignable (il redémarre peut-être) : nouvel essai automatique.',
  en: 'The reading receiver is unreachable (it may be restarting): retrying automatically.',
};

/**
 * @param {object} [options] injections pour les tests
 * @param {object} [options.gladys] instance du SDK
 * @param {object} [options.store] état persistant
 * @param {string} [options.receiverUrl] adresse du port interne du receiver
 */
export async function startIntegration({
  gladys = new GladysIntegration(),
  store = createStore(),
  receiverUrl = RECEIVER_URL,
} = {}) {
  const publisher = createPublisher(gladys);

  let config = normalizeConfig();
  let localClient = null;

  // Problème en cours sur la source des relevés, ou null si tout va bien.
  // `setConnectionStatus` n'est rappelé qu'aux changements.
  let sourceProblem = null;
  // État du flux du receiver : inconnu tant qu'il n'a ni réussi ni échoué.
  let receiverUp = null;

  await store.load();

  const receiver = createReceiverClient({
    baseUrl: receiverUrl,
    onReading: (reading) => handleReading(reading),
    onStreamStatus: async (up) => {
      receiverUp = up;
      if (resolveMode(config) === MODES.PUSH) {
        await reportSource(up ? null : RECEIVER_UNREACHABLE);
      }
    },
  });

  // --- Statut de connexion ----------------------------------------------------

  /**
   * Reflète l'état de la source dans l'écran de configuration.
   * @param {object|null} problem message multilingue, ou null si tout va bien
   * @param {object} [options]
   * @param {boolean} [options.force] renvoyer même sans changement (reconnexion)
   */
  async function reportSource(problem, { force = false } = {}) {
    const changed = (problem?.en ?? null) !== (sourceProblem?.en ?? null);
    sourceProblem = problem;
    if (!changed && !force) {
      return;
    }
    if (changed) {
      if (problem) {
        logger.warn(problem.fr);
      } else {
        logger.info('Source des relevés de nouveau joignable');
      }
    }
    await gladys
      .setConnectionStatus(!problem, problem ?? undefined)
      .catch((err) => logger.warn(`Statut de connexion non transmis (${err.message})`));
  }

  /** Statut attendu pour le mode courant, après un changement de configuration. */
  function currentSourceProblem() {
    if (resolveMode(config) === MODES.PUSH) {
      return receiverUp === false ? RECEIVER_UNREACHABLE : null;
    }
    // Mode local : le prochain appel à la passerelle tranchera.
    return null;
  }

  /** Interroge la passerelle en tenant le statut de connexion à jour. */
  async function pollGateway() {
    try {
      const observation = await localClient.getObservation();
      await reportSource(null);
      return observation;
    } catch (err) {
      await reportSource(gatewayUnreachable(config.gateway_ip));
      throw err;
    }
  }

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
      await ingest(await pollGateway());
    }
    await publishDevices();
  });

  gladys.onPoll(async () => {
    if (!localClient) {
      return; // en mode push, c'est la station qui donne le rythme
    }
    await ingest(await pollGateway());
  });

  gladys.onConfigUpdated(async (raw) => {
    config = normalizeConfig(raw);
    refreshLocalClient();
    await reportSource(currentSourceProblem());
    await publishDevices();
  });

  gladys.onAction('test_reception', async () => {
    const mode = resolveMode(config);
    if (mode === MODES.LOCAL) {
      const observation = await pollGateway();
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
      // Pas de `true` d'office : Gladys revient, mais la source peut être
      // toujours coupée. En mode local, le dernier résultat connu fait foi
      // jusqu'au prochain appel à la passerelle.
      const problem = resolveMode(config) === MODES.PUSH ? currentSourceProblem() : sourceProblem;
      await reportSource(problem, { force: true });
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
