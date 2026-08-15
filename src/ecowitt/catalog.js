// -----------------------------------------------------------------------------
// Catalogue des capteurs Ecowitt.
//
// Décrit, pour chaque type de capteur, le device Gladys correspondant et ses
// fonctionnalités. C'est la seule référence du mapping : les adaptateurs
// (push / API locale) se contentent de produire des `values` dont les clés
// correspondent aux `key` déclarées ici.
//
// Note sur les catégories : plusieurs catégories Gladys (`rain-sensor`,
// `angle-sensor`, `light-sensor`, `leak-sensor`...) n'ont pas de bloc de types
// dédié dans `constants.js`. Elles utilisent les types génériques
// DEVICE_FEATURE_TYPES.SENSOR.*, ce qui est le motif employé partout dans
// Gladys pour un capteur en lecture seule.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';

/** Base commune à toute fonctionnalité de mesure : lecture seule, historisée. */
const sensor = (key, name, category, type, unit, min, max) => ({
  key,
  name,
  category,
  type,
  unit,
  min,
  max,
  read_only: true,
  has_feedback: false,
  keep_history: true,
});

// --- Fabriques des mesures récurrentes ---------------------------------------

const temperature = (key = 'temperature', name = { fr: 'Température', en: 'Temperature' }) =>
  sensor(key, name, CATEGORIES.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.CELSIUS, -50, 80);

const humidity = (key = 'humidity', name = { fr: 'Humidité', en: 'Humidity' }) =>
  sensor(key, name, CATEGORIES.HUMIDITY_SENSOR, TYPES.SENSOR.INTEGER, UNITS.PERCENT, 0, 100);

const pressure = (key, name) =>
  sensor(
    key,
    name,
    CATEGORIES.PRESSURE_SENSOR,
    TYPES.SENSOR.DECIMAL,
    UNITS.HECTO_PASCAL,
    800,
    1100,
  );

const windSpeed = (key, name) =>
  sensor(
    key,
    name,
    CATEGORIES.SPEED_SENSOR,
    TYPES.SENSOR.DECIMAL,
    UNITS.KILOMETER_PER_HOUR,
    0,
    400,
  );

const rainAmount = (key, name) =>
  sensor(key, name, CATEGORIES.RAIN_SENSOR, TYPES.SENSOR.DECIMAL, UNITS.MM, 0, 10000);

const pm25 = (key, name) =>
  sensor(
    key,
    name,
    CATEGORIES.PM25_SENSOR,
    TYPES.SENSOR.DECIMAL,
    UNITS.MICROGRAM_PER_CUBIC_METER,
    0,
    1000,
  );

const pm10 = (key, name) =>
  sensor(
    key,
    name,
    CATEGORIES.PM10_SENSOR,
    TYPES.SENSOR.DECIMAL,
    UNITS.MICROGRAM_PER_CUBIC_METER,
    0,
    1000,
  );

// --- Catalogue ---------------------------------------------------------------

export const SENSOR_CATALOG = {
  // Console ou passerelle : le capteur intérieur intégré (WH25/WH32B).
  gateway: {
    name: { fr: 'Console Ecowitt', en: 'Ecowitt console' },
    features: [
      temperature('temperature', { fr: 'Température intérieure', en: 'Indoor temperature' }),
      humidity('humidity', { fr: 'Humidité intérieure', en: 'Indoor humidity' }),
      pressure('pressureRelative', { fr: 'Pression relative', en: 'Relative pressure' }),
      pressure('pressureAbsolute', { fr: 'Pression absolue', en: 'Absolute pressure' }),
    ],
  },

  // Station extérieure multi-capteurs (WH65, WH69, WH68, WS80, WS90...).
  outdoor: {
    name: { fr: 'Station extérieure', en: 'Outdoor station' },
    features: [
      temperature('temperature', { fr: 'Température extérieure', en: 'Outdoor temperature' }),
      humidity('humidity', { fr: 'Humidité extérieure', en: 'Outdoor humidity' }),
      temperature('dewPoint', { fr: 'Point de rosée', en: 'Dew point' }),
      temperature('windChill', { fr: 'Refroidissement éolien', en: 'Wind chill' }),
      windSpeed('windSpeed', { fr: 'Vitesse du vent', en: 'Wind speed' }),
      windSpeed('windGust', { fr: 'Rafale', en: 'Wind gust' }),
      windSpeed('windGustMaxDaily', { fr: 'Rafale max. du jour', en: 'Max daily gust' }),
      sensor(
        'windDirection',
        { fr: 'Direction du vent', en: 'Wind direction' },
        CATEGORIES.ANGLE_SENSOR,
        TYPES.SENSOR.INTEGER,
        UNITS.DEGREE,
        0,
        360,
      ),
      sensor(
        'solarRadiation',
        { fr: 'Ensoleillement', en: 'Solar radiation' },
        CATEGORIES.LIGHT_SENSOR,
        TYPES.SENSOR.DECIMAL,
        UNITS.LUX,
        0,
        200000,
      ),
      sensor(
        'uvIndex',
        { fr: 'Indice UV', en: 'UV index' },
        CATEGORIES.UV_SENSOR,
        TYPES.SENSOR.INTEGER,
        UNITS.UV_INDEX,
        0,
        16,
      ),
    ],
  },

  // Pluviomètre : device distinct, qu'il soit autonome (WH40) ou intégré à la
  // station. Les cumuls forment un bloc cohérent que l'utilisateur peut vouloir
  // créer — ou non — indépendamment du reste.
  rain: {
    name: { fr: 'Pluviomètre', en: 'Rain gauge' },
    features: [
      sensor(
        'rainRate',
        { fr: 'Intensité de pluie', en: 'Rain rate' },
        CATEGORIES.PRECIPITATION_SENSOR,
        TYPES.SENSOR.DECIMAL,
        UNITS.MILLIMETER_PER_HOUR,
        0,
        1000,
      ),
      rainAmount('rainEvent', { fr: 'Pluie (épisode)', en: 'Event rain' }),
      rainAmount('rainHourly', { fr: 'Pluie (heure)', en: 'Hourly rain' }),
      rainAmount('rainDaily', { fr: 'Pluie (jour)', en: 'Daily rain' }),
      rainAmount('rainWeekly', { fr: 'Pluie (semaine)', en: 'Weekly rain' }),
      rainAmount('rainMonthly', { fr: 'Pluie (mois)', en: 'Monthly rain' }),
      rainAmount('rainYearly', { fr: 'Pluie (année)', en: 'Yearly rain' }),
    ],
  },

  // WH31 : température + humidité déportées, 8 canaux.
  wh31: {
    name: { fr: 'Capteur temp./hum.', en: 'Temp./hum. sensor' },
    channels: 8,
    features: [temperature(), humidity()],
  },

  // WH34 : sonde de température seule (piscine, sol...), 8 canaux.
  wh34: {
    name: { fr: 'Sonde de température', en: 'Temperature probe' },
    channels: 8,
    features: [temperature()],
  },

  // WH51 : humidité du sol, 16 canaux.
  wh51: {
    name: { fr: 'Humidité du sol', en: 'Soil moisture' },
    channels: 16,
    features: [
      sensor(
        'soilMoisture',
        { fr: 'Humidité du sol', en: 'Soil moisture' },
        CATEGORIES.SOIL_MOISTURE_SENSOR,
        TYPES.SENSOR.INTEGER,
        UNITS.PERCENT,
        0,
        100,
      ),
    ],
  },

  // WH35 : humidité foliaire, 8 canaux.
  wh35: {
    name: { fr: 'Humidité foliaire', en: 'Leaf wetness' },
    channels: 8,
    features: [
      sensor(
        'leafWetness',
        { fr: 'Humidité foliaire', en: 'Leaf wetness' },
        CATEGORIES.HUMIDITY_SENSOR,
        TYPES.SENSOR.INTEGER,
        UNITS.PERCENT,
        0,
        100,
      ),
    ],
  },

  // WH41 / WH43 : qualité de l'air PM2.5, 4 canaux.
  wh41: {
    name: { fr: 'Capteur PM2.5', en: 'PM2.5 sensor' },
    channels: 4,
    features: [
      pm25('pm25', { fr: 'PM2.5', en: 'PM2.5' }),
      pm25('pm25Avg24h', { fr: 'PM2.5 (24 h)', en: 'PM2.5 (24h)' }),
    ],
  },

  // WH45 / WH46 : sonde combinée CO2 + particules.
  wh45: {
    name: { fr: 'Capteur CO2', en: 'CO2 sensor' },
    features: [
      sensor(
        'co2',
        { fr: 'CO2', en: 'CO2' },
        CATEGORIES.CO2_SENSOR,
        TYPES.SENSOR.INTEGER,
        UNITS.PPM,
        0,
        10000,
      ),
      sensor(
        'co2Avg24h',
        { fr: 'CO2 (24 h)', en: 'CO2 (24h)' },
        CATEGORIES.CO2_SENSOR,
        TYPES.SENSOR.INTEGER,
        UNITS.PPM,
        0,
        10000,
      ),
      pm25('pm25', { fr: 'PM2.5', en: 'PM2.5' }),
      pm25('pm25Avg24h', { fr: 'PM2.5 (24 h)', en: 'PM2.5 (24h)' }),
      pm10('pm10', { fr: 'PM10', en: 'PM10' }),
      pm10('pm10Avg24h', { fr: 'PM10 (24 h)', en: 'PM10 (24h)' }),
      temperature(),
      humidity(),
    ],
  },

  // WH55 : détecteur de fuite d'eau, 4 canaux.
  wh55: {
    name: { fr: 'Détecteur de fuite', en: 'Leak detector' },
    channels: 4,
    features: [
      sensor(
        'leak',
        { fr: 'Fuite détectée', en: 'Leak detected' },
        CATEGORIES.LEAK_SENSOR,
        TYPES.SENSOR.BINARY,
        undefined,
        0,
        1,
      ),
    ],
  },

  // WH57 : détecteur de foudre.
  wh57: {
    name: { fr: 'Détecteur de foudre', en: 'Lightning detector' },
    features: [
      sensor(
        'lightningCount',
        { fr: 'Impacts détectés', en: 'Strike count' },
        CATEGORIES.COUNTER_SENSOR,
        TYPES.SENSOR.INTEGER,
        undefined,
        0,
        100000,
      ),
      sensor(
        'lightningDistance',
        { fr: 'Distance du dernier impact', en: 'Last strike distance' },
        CATEGORIES.DISTANCE_SENSOR,
        TYPES.SENSOR.DECIMAL,
        UNITS.KM,
        0,
        40,
      ),
    ],
  },
};

// --- Fonctionnalités transverses ---------------------------------------------

/** Fonctionnalité « batterie faible », pour les capteurs à drapeau ou tension. */
export const BATTERY_LOW_FEATURE = {
  key: 'batteryLow',
  name: { fr: 'Batterie faible', en: 'Low battery' },
  category: CATEGORIES.BATTERY_LOW,
  type: TYPES.BATTERY_LOW.BINARY,
  unit: undefined,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: false,
};

/** Fonctionnalité « batterie », pour les capteurs qui publient un niveau 0-5. */
export const BATTERY_FEATURE = {
  key: 'battery',
  name: { fr: 'Batterie', en: 'Battery' },
  category: CATEGORIES.BATTERY,
  type: TYPES.BATTERY.INTEGER,
  unit: UNITS.PERCENT,
  min: 0,
  max: 100,
  read_only: true,
  has_feedback: false,
  keep_history: true,
};

/** Qualité du signal radio, fournie uniquement par l'API locale (0 à 4). */
export const SIGNAL_FEATURE = {
  key: 'signal',
  name: { fr: 'Signal', en: 'Signal' },
  category: CATEGORIES.SIGNAL,
  type: TYPES.SIGNAL.QUALITY,
  unit: UNITS.PERCENT,
  min: 0,
  max: 100,
  read_only: true,
  has_feedback: false,
  keep_history: false,
};

/**
 * Décrit un type de capteur.
 * @param {string} type clé du catalogue
 */
export function describeSensor(type) {
  return SENSOR_CATALOG[type] ?? null;
}

/** Nom affiché du device, canal inclus lorsque le capteur est multi-canal. */
export function buildDeviceName(type, channel) {
  const description = describeSensor(type);
  if (!description) {
    return `Ecowitt ${type}`;
  }
  const base = description.name.fr;
  return channel ? `${base} ${channel}` : base;
}
