// -----------------------------------------------------------------------------
// État local de l'intégration.
//
// Deux besoins que la seule dernière observation ne couvre pas :
//
//  1. La DÉCOUVERTE doit survivre à un redémarrage. En mode push, les capteurs
//     ne sont connus qu'après le premier envoi de la station, qui peut être à
//     plusieurs minutes : sans mémoire, l'écran Découverte serait vide après
//     chaque redémarrage du conteneur.
//
//  2. La structure d'un device doit être STABLE. Une mesure peut manquer
//     ponctuellement (la rafale maximale du jour est remise à zéro à minuit,
//     un capteur saute un envoi) ; publier la seule dernière observation ferait
//     apparaître et disparaître des fonctionnalités. On accumule donc l'union
//     des mesures déjà vues pour chaque capteur.
//
// `/data` est le seul emplacement inscriptible du conteneur.
// -----------------------------------------------------------------------------

import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

const DEFAULT_PATH = process.env.GLADYS_ECOWITT_STATE_PATH ?? '/data/state.json';

/** Identifie un capteur au sein d'une station. */
export const sensorKey = (type, channel) => (channel ? `${type}:${channel}` : type);

export function createStore({ path = DEFAULT_PATH } = {}) {
  /** @type {{ stationId: string|null, sensors: Record<string, object> }} */
  let state = { stationId: null, sensors: {} };
  let writeScheduled = null;
  let tmpCounter = 0;

  return {
    get state() {
      return state;
    },

    async load() {
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8'));
        // Un JSON valide n'est pas forcément un état : `null`, un tableau ou
        // des capteurs qui ne sont pas un objet feraient échouer `merge`.
        if (!isPlainObject(parsed) || !isPlainObject(parsed.sensors ?? {})) {
          throw new Error('structure inattendue');
        }
        state = { stationId: null, ...parsed, sensors: parsed.sensors ?? {} };
        logger.info(`État rechargé : ${Object.keys(state.sensors).length} capteur(s) connu(s)`);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`État illisible (${err.message}), redémarrage à vide`);
        }
        state = { stationId: null, sensors: {} };
      }
      return state;
    },

    /**
     * Fusionne une observation dans l'état.
     * @returns {boolean} true si le PROFIL a changé (nouveau capteur ou
     *   nouvelle mesure), ce qui justifie de republier les devices découverts.
     */
    merge(observation) {
      let profileChanged = false;

      if (observation.stationId && observation.stationId !== state.stationId) {
        state.stationId = observation.stationId;
        profileChanged = true;
      }

      for (const sensor of observation.sensors) {
        const key = sensorKey(sensor.type, sensor.channel);
        const known = state.sensors[key];
        const seenKeys = new Set([...(known?.featureKeys ?? []), ...Object.keys(sensor.values)]);

        const batteryKind = sensor.battery?.kind ?? known?.batteryKind ?? null;
        const hasSignal = sensor.signal !== null || Boolean(known?.hasSignal);
        // L'identifiant matériel n'existe qu'en mode API locale ; on ne
        // l'efface pas si une observation push arrive ensuite.
        const hardwareId = sensor.hardwareId ?? known?.hardwareId ?? null;

        if (
          !known ||
          known.featureKeys.length !== seenKeys.size ||
          known.batteryKind !== batteryKind ||
          known.hasSignal !== hasSignal ||
          known.hardwareId !== hardwareId
        ) {
          profileChanged = true;
        }

        state.sensors[key] = {
          type: sensor.type,
          channel: sensor.channel,
          hardwareId,
          featureKeys: [...seenKeys],
          batteryKind,
          hasSignal,
          lastSeenAt: observation.receivedAt,
        };
      }

      return profileChanged;
    },

    /** Écriture différée : les envois d'une station sont fréquents. */
    scheduleSave() {
      if (writeScheduled) {
        return;
      }
      writeScheduled = setTimeout(() => {
        writeScheduled = null;
        this.save().catch((err) => logger.warn(`Sauvegarde impossible (${err.message})`));
      }, 2_000);
      writeScheduled.unref?.();
    },

    async save() {
      await mkdir(dirname(path), { recursive: true }).catch(() => {});
      // Écriture atomique : un arrêt en pleine écriture laisse l'ancien
      // fichier intact au lieu d'un JSON tronqué. Un nom temporaire par
      // écriture, pour que deux sauvegardes simultanées ne se mélangent pas.
      tmpCounter += 1;
      const tmpPath = `${path}.${process.pid}.${tmpCounter}.tmp`;
      try {
        await writeFile(tmpPath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
        await rename(tmpPath, path);
      } catch (err) {
        await rm(tmpPath, { force: true }).catch(() => {});
        throw err;
      }
    },

    reset() {
      state = { stationId: null, sensors: {} };
    },
  };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
