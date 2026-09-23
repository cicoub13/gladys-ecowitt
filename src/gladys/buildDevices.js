// -----------------------------------------------------------------------------
// Traduction de l'état accumulé vers le modèle de Gladys.
//
// Un device Gladys par capteur physique : la console, la station extérieure, le
// pluviomètre, puis un device par canal de chaque sonde déportée. Chacun porte
// sa propre batterie et son propre signal, et l'utilisateur choisit dans
// l'écran Découverte ceux qu'il souhaite créer.
// -----------------------------------------------------------------------------

import {
  BATTERY_FEATURE,
  BATTERY_LOW_FEATURE,
  SIGNAL_FEATURE,
  buildDeviceName,
  describeSensor,
} from '../ecowitt/catalog.js';
import { sensorKey } from '../store.js';

/**
 * Identifiant de plateforme d'un capteur : il doit être unique et stable.
 *
 * L'API locale fournit l'identifiant matériel du capteur, qui reste le même
 * quand il change de canal — c'est le meilleur ancrage. Le protocole push ne le
 * transporte pas : on retombe alors sur « station + type + canal », stable tant
 * que le capteur reste sur son canal.
 */
export function platformId(stationId, sensor) {
  if (sensor.hardwareId) {
    return `${sensor.type}-${sensor.hardwareId}`;
  }
  return `${stationId ?? 'unknown'}-${sensorKey(sensor.type, sensor.channel)}`;
}

/** Construit les identifiants Gladys d'un capteur. */
export function idsFor(gladys, stationId, sensor) {
  return gladys.externalIds(sensor.type, platformId(stationId, sensor));
}

/**
 * Payload de `publishDiscoveredDevices`, dérivé de l'état accumulé.
 * @param {object} gladys instance du SDK
 * @param {object} state état du store
 * @param {object} [options]
 * @param {number} [options.pollFrequency] intervalle d'appel de `onPoll`, en
 *   secondes ; omis en mode push, où c'est la station qui décide du rythme
 */
export function buildDiscoveredDevices(gladys, state, { pollFrequency } = {}) {
  return Object.values(state.sensors)
    .map((sensor) => buildDevice(gladys, state.stationId, sensor, pollFrequency))
    .filter(Boolean);
}

function buildDevice(gladys, stationId, sensor, pollFrequency) {
  const description = describeSensor(sensor.type);
  if (!description) {
    return null; // type inconnu du catalogue : on ne devine pas
  }
  const ids = idsFor(gladys, stationId, sensor);
  const seen = new Set(sensor.featureKeys);

  const features = description.features
    .filter((feature) => seen.has(feature.key))
    .map((feature) => toGladysFeature(ids, feature));

  if (sensor.batteryKind === 'low') {
    features.push(toGladysFeature(ids, BATTERY_LOW_FEATURE));
  } else if (sensor.batteryKind === 'percent') {
    features.push(toGladysFeature(ids, BATTERY_FEATURE));
  }
  if (sensor.hasSignal) {
    features.push(toGladysFeature(ids, SIGNAL_FEATURE));
  }

  if (features.length === 0) {
    return null;
  }

  return {
    name: buildDeviceName(sensor.type, sensor.channel),
    external_id: ids.device,
    // Gladys attend des millisecondes (voir POLL_FREQUENCIES_SECONDS).
    ...(pollFrequency ? { poll_frequency: pollFrequency * 1000 } : {}),
    features,
  };
}

function toGladysFeature(ids, feature) {
  return {
    name: feature.name.fr,
    external_id: ids.feature(feature.key),
    category: feature.category,
    type: feature.type,
    ...(feature.unit ? { unit: feature.unit } : {}),
    min: feature.min,
    max: feature.max,
    read_only: feature.read_only,
    has_feedback: feature.has_feedback,
    keep_history: feature.keep_history,
  };
}

/**
 * Aplatit une observation en états publiables.
 * @returns {{ device_feature_external_id: string, state: number }[]}
 */
export function buildStates(gladys, stationId, observation) {
  const states = [];

  for (const sensor of observation.sensors) {
    const ids = idsFor(gladys, stationId, sensor);
    const description = describeSensor(sensor.type);
    if (!description) {
      continue;
    }
    const known = new Set(description.features.map((feature) => feature.key));

    for (const [key, value] of Object.entries(sensor.values)) {
      if (!known.has(key) || !Number.isFinite(value)) {
        continue;
      }
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }

    if (sensor.battery?.kind === 'low') {
      states.push({
        device_feature_external_id: ids.feature(BATTERY_LOW_FEATURE.key),
        state: sensor.battery.low ? 1 : 0,
      });
    } else if (sensor.battery?.kind === 'percent') {
      states.push({
        device_feature_external_id: ids.feature(BATTERY_FEATURE.key),
        state: sensor.battery.percent,
      });
    }

    if (sensor.signal !== null && sensor.signal !== undefined) {
      states.push({
        device_feature_external_id: ids.feature(SIGNAL_FEATURE.key),
        state: sensor.signal,
      });
    }
  }

  return states;
}
