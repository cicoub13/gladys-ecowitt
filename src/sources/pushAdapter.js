// -----------------------------------------------------------------------------
// Adaptateur du protocole push « Custom Server » d'Ecowitt.
//
// La station envoie un POST `application/x-www-form-urlencoded` à clés plates.
// Ses unités sont IMPÉRIALES et fixes, quels que soient les réglages affichés
// sur la console : la conversion est donc déterministe, contrairement à celle
// de l'API locale.
//
// Rôle du module : produire l'« observation pivot », seul format que connaisse
// la suite de la chaîne (catalogue, construction des devices, publication).
// -----------------------------------------------------------------------------

import { readPushValue, round, wattPerSquareMeterToLux } from '../ecowitt/units.js';
import { readPushBattery } from '../ecowitt/battery.js';

/**
 * Table de correspondance : clé de fonctionnalité -> [clé du POST, unité source].
 * L'unité `null` signifie « aucune conversion » (pourcentage, indice, ppm...).
 */
const GATEWAY_FIELDS = {
  temperature: ['tempinf', 'f'],
  humidity: ['humidityin', null],
  pressureRelative: ['baromrelin', 'inhg'],
  pressureAbsolute: ['baromabsin', 'inhg'],
};

const OUTDOOR_FIELDS = {
  temperature: ['tempf', 'f'],
  humidity: ['humidity', null],
  dewPoint: ['dewptf', 'f'],
  windChill: ['windchillf', 'f'],
  windSpeed: ['windspeedmph', 'mph'],
  windGust: ['windgustmph', 'mph'],
  windGustMaxDaily: ['maxdailygust', 'mph'],
  windDirection: ['winddir', null],
  uvIndex: ['uv', null],
};

const RAIN_FIELDS = {
  rainRate: ['rainratein', 'in'],
  rainEvent: ['eventrainin', 'in'],
  rainHourly: ['hourlyrainin', 'in'],
  rainDaily: ['dailyrainin', 'in'],
  rainWeekly: ['weeklyrainin', 'in'],
  rainMonthly: ['monthlyrainin', 'in'],
  rainYearly: ['yearlyrainin', 'in'],
};

// Pluviomètre piézoélectrique (WS90) : mêmes mesures, préfixe différent. Il
// prend le pas sur le pluviomètre à auget lorsque les deux sont présents.
const PIEZO_RAIN_FIELDS = {
  rainRate: ['rrain_piezo', 'in'],
  rainEvent: ['erain_piezo', 'in'],
  rainHourly: ['hrain_piezo', 'in'],
  rainDaily: ['drain_piezo', 'in'],
  rainWeekly: ['wrain_piezo', 'in'],
  rainMonthly: ['mrain_piezo', 'in'],
  rainYearly: ['yrain_piezo', 'in'],
};

const CO2_FIELDS = {
  co2: ['co2', null],
  co2Avg24h: ['co2_24h', null],
  pm25: ['pm25_co2', null],
  pm25Avg24h: ['pm25_24h_co2', null],
  pm10: ['pm10_co2', null],
  pm10Avg24h: ['pm10_24h_co2', null],
  temperature: ['tf_co2', 'f'],
  humidity: ['humi_co2', null],
};

const LIGHTNING_FIELDS = {
  lightningCount: ['lightning_num', null],
  lightningDistance: ['lightning', null], // déjà en kilomètres
};

/** Batteries associées à un device non multi-canal, par ordre de préférence. */
const GATEWAY_BATTERY_KEYS = ['wh25batt', 'wh32batt', 'wh26batt'];
const OUTDOOR_BATTERY_KEYS = ['wh65batt', 'wh80batt', 'wh90batt', 'wh68batt', 'wh24batt'];
const RAIN_BATTERY_KEYS = ['wh40batt'];

/**
 * Transforme un payload push en observation pivot.
 *
 * @param {Record<string, string>} payload champs du POST, déjà décodés
 * @returns {{ stationId: string, model: string|null, receivedAt: string, sensors: object[] }}
 */
export function toObservation(payload) {
  const sensors = [];

  addSensor(sensors, 'gateway', null, collect(payload, GATEWAY_FIELDS), {
    battery: firstBattery(payload, GATEWAY_BATTERY_KEYS),
  });

  const outdoor = collect(payload, OUTDOOR_FIELDS);
  // L'ensoleillement demande une conversion propre (W/m² -> lux).
  const solar = Number(payload.solarradiation);
  if (Number.isFinite(solar)) {
    outdoor.solarRadiation = round(wattPerSquareMeterToLux(solar), 1);
  }
  addSensor(sensors, 'outdoor', null, outdoor, {
    battery: firstBattery(payload, OUTDOOR_BATTERY_KEYS),
  });

  const piezoRain = collect(payload, PIEZO_RAIN_FIELDS);
  const rain = Object.keys(piezoRain).length > 0 ? piezoRain : collect(payload, RAIN_FIELDS);
  addSensor(sensors, 'rain', null, rain, { battery: firstBattery(payload, RAIN_BATTERY_KEYS) });

  addSensor(sensors, 'wh45', null, collect(payload, CO2_FIELDS), {
    battery: readBattery(payload, 'co2_batt'),
  });

  addSensor(sensors, 'wh57', null, collect(payload, LIGHTNING_FIELDS), {
    battery: readBattery(payload, 'wh57batt'),
  });

  addChannelSensors(sensors, payload, {
    type: 'wh31',
    channels: 8,
    fields: (n) => ({ temperature: [`temp${n}f`, 'f'], humidity: [`humidity${n}`, null] }),
    batteryKey: (n) => `batt${n}`,
  });

  addChannelSensors(sensors, payload, {
    type: 'wh34',
    channels: 8,
    fields: (n) => ({ temperature: [`tf_ch${n}`, 'f'] }),
    batteryKey: (n) => `tf_batt${n}`,
  });

  addChannelSensors(sensors, payload, {
    type: 'wh51',
    channels: 16,
    fields: (n) => ({ soilMoisture: [`soilmoisture${n}`, null] }),
    batteryKey: (n) => `soilbatt${n}`,
  });

  addChannelSensors(sensors, payload, {
    type: 'wh35',
    channels: 8,
    fields: (n) => ({ leafWetness: [`leafwetness_ch${n}`, null] }),
    batteryKey: (n) => `leaf_batt${n}`,
  });

  addChannelSensors(sensors, payload, {
    type: 'wh41',
    channels: 4,
    fields: (n) => ({
      pm25: [`pm25_ch${n}`, null],
      pm25Avg24h: [`pm25_avg_24h_ch${n}`, null],
    }),
    batteryKey: (n) => `pm25batt${n}`,
  });

  addChannelSensors(sensors, payload, {
    type: 'wh55',
    channels: 4,
    // Le protocole renvoie 0 (sec) ou 1 (fuite) : une binaire, pas une mesure.
    fields: (n) => ({ leak: [`leak_ch${n}`, null] }),
    batteryKey: (n) => `leakbatt${n}`,
  });

  return {
    stationId: payload.PASSKEY ?? payload.passkey ?? null,
    model: payload.model ?? payload.stationtype ?? null,
    receivedAt: new Date().toISOString(),
    sensors,
  };
}

// --- Utilitaires internes ----------------------------------------------------

/** Extrait et convertit les champs présents dans le payload. */
function collect(payload, fields) {
  const values = {};
  for (const [featureKey, [payloadKey, unit]] of Object.entries(fields)) {
    if (payload[payloadKey] === undefined || payload[payloadKey] === '') {
      continue;
    }
    const value = readPushValue(payload[payloadKey], unit);
    if (value !== null) {
      values[featureKey] = value;
    }
  }
  return values;
}

function addSensor(sensors, type, channel, values, { battery = null, signal = null } = {}) {
  if (Object.keys(values).length === 0) {
    return; // capteur absent de ce payload
  }
  sensors.push({ type, channel, hardwareId: null, values, battery, signal });
}

function addChannelSensors(sensors, payload, { type, channels, fields, batteryKey }) {
  for (let channel = 1; channel <= channels; channel += 1) {
    addSensor(sensors, type, channel, collect(payload, fields(channel)), {
      battery: readBattery(payload, batteryKey(channel)),
    });
  }
}

function readBattery(payload, key) {
  if (payload[key] === undefined || payload[key] === '') {
    return null;
  }
  return readPushBattery(key, payload[key]);
}

function firstBattery(payload, keys) {
  for (const key of keys) {
    const battery = readBattery(payload, key);
    if (battery) {
      return battery;
    }
  }
  return null;
}
