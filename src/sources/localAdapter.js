// -----------------------------------------------------------------------------
// Adaptateur de l'API HTTP locale Ecowitt.
//
// Disponible sur les passerelles récentes uniquement (GW1100/1200/2000/3000 et
// consoles WS38xx/WS39xx/WN19xx) — ni la WS2910 ni le GW1000 ne l'exposent.
// Deux points d'entrée, sans authentification :
//   - `/get_livedata_info`  : les mesures, avec leur unité DANS la chaîne, et
//     cette unité suit les réglages de l'utilisateur. Elle se lit, jamais ne
//     se suppose.
//   - `/get_sensors_info`   : les capteurs appairés, avec leur identifiant
//     matériel — ce qui permet des `external_id` stables même si un capteur
//     change de canal, ce que le protocole push ne permet pas.
//
// Le conteneur d'intégration peut joindre le LAN en unicast : seuls les
// broadcasts sont bloqués (d'où `scanNetwork` pour la découverte).
// -----------------------------------------------------------------------------

import { readLocalValue, round, wattPerSquareMeterToLux } from '../ecowitt/units.js';
import { readLocalBattery } from '../ecowitt/battery.js';

/** Identifiants de `common_list`, documentés dans « HTTP API interface ». */
const COMMON_LIST_IDS = {
  '0x02': 'temperature',
  '0x03': 'dewPoint',
  '0x04': 'windChill',
  '0x07': 'humidity',
  '0x0A': 'windDirection',
  '0x0B': 'windSpeed',
  '0x0C': 'windGust',
  '0x15': 'solarRadiation',
  '0x17': 'uvIndex',
  '0x19': 'windGustMaxDaily',
};

/** Identifiants des blocs `rain` et `piezoRain`. */
const RAIN_IDS = {
  '0x0D': 'rainEvent',
  '0x0E': 'rainRate',
  '0x10': 'rainDaily',
  '0x11': 'rainWeekly',
  '0x12': 'rainMonthly',
  '0x13': 'rainYearly',
};

/** Bloc multi-canal -> type du catalogue et clés de mesure. */
const CHANNEL_BLOCKS = [
  { block: 'ch_aisle', type: 'wh31', read: readTemperatureHumidity },
  { block: 'ch_temp', type: 'wh34', read: readTemperatureOnly },
  { block: 'ch_soil', type: 'wh51', read: (entry) => ({ soilMoisture: percent(entry.humidity) }) },
  { block: 'ch_leaf', type: 'wh35', read: (entry) => ({ leafWetness: percent(entry.humidity) }) },
  { block: 'ch_pm25', type: 'wh41', read: readPm25 },
  {
    block: 'ch_leak',
    type: 'wh55',
    read: (entry) => ({ leak: entry.status === 'Normal' ? 0 : 1 }),
  },
];

/** Un capteur non appairé porte cet identifiant au lieu du sien. */
const ABSENT_HARDWARE_IDS = new Set(['FFFFFFFF', 'FFFFFFFE']);

/**
 * Construit l'observation pivot à partir des deux réponses de l'API locale.
 * Fonction pure : c'est elle que couvrent les tests.
 *
 * @param {object} live réponse de `/get_livedata_info`
 * @param {object} [sensorsInfo] réponse de `/get_sensors_info`
 */
export function buildObservation(live, sensorsInfo = null) {
  const sensors = [];
  const inventory = indexSensors(sensorsInfo);

  // --- Console : bloc `wh25` (capteur intérieur intégré) --------------------
  const indoor = first(live.wh25);
  if (indoor) {
    addSensor(sensors, 'gateway', null, {
      temperature: readLocalValue(indoor.intemp, indoor.unit),
      humidity: percent(indoor.inhumi),
      pressureRelative: readLocalValue(indoor.rel),
      pressureAbsolute: readLocalValue(indoor.abs),
    });
  }

  // --- Station extérieure : bloc `common_list` ------------------------------
  const outdoor = {};
  for (const item of live.common_list ?? []) {
    const key = COMMON_LIST_IDS[String(item.id).toUpperCase()] ?? COMMON_LIST_IDS[item.id];
    if (!key) {
      continue; // mesure non exposée (indice de chaleur, ressenti, horodatage...)
    }
    outdoor[key] = readLocalValue(item.val, item.unit);
  }
  // L'ensoleillement arrive en W/m² et Gladys attend des lux.
  if (Number.isFinite(outdoor.solarRadiation)) {
    outdoor.solarRadiation = round(wattPerSquareMeterToLux(outdoor.solarRadiation), 1);
  }
  addSensor(
    sensors,
    'outdoor',
    null,
    outdoor,
    inventory.forTypes(['wh65', 'wh80', 'wh90', 'wh68']),
  );

  // --- Pluviomètre : le piézoélectrique prime sur l'auget -------------------
  const rainBlock = (live.piezoRain?.length ? live.piezoRain : live.rain) ?? [];
  const rain = {};
  for (const item of rainBlock) {
    const key = RAIN_IDS[String(item.id).toUpperCase()] ?? RAIN_IDS[item.id];
    if (key) {
      rain[key] = readLocalValue(item.val);
    }
  }
  addSensor(sensors, 'rain', null, rain, inventory.forTypes(['wh40', 'wh90', 'wh85']));

  // --- Foudre ---------------------------------------------------------------
  const lightning = first(live.lightning);
  if (lightning) {
    addSensor(
      sensors,
      'wh57',
      null,
      {
        lightningCount: toNumber(lightning.count),
        lightningDistance: readLocalValue(lightning.distance),
      },
      {
        ...inventory.forTypes(['wh57']),
        battery: readLocalBattery('wh57', lightning.battery),
      },
    );
  }

  // --- CO2 et particules ----------------------------------------------------
  const co2 = first(live.co2);
  if (co2) {
    addSensor(
      sensors,
      'wh45',
      null,
      {
        co2: toNumber(co2.CO2),
        co2Avg24h: toNumber(co2.CO2_24H),
        pm25: toNumber(co2.PM25),
        pm25Avg24h: toNumber(co2.PM25_24H),
        pm10: toNumber(co2.PM10),
        pm10Avg24h: toNumber(co2.PM10_24H),
        temperature: readLocalValue(co2.temp, co2.unit),
        humidity: percent(co2.humidity),
      },
      {
        ...inventory.forTypes(['wh45']),
        battery: readLocalBattery('wh45', co2.battery),
      },
    );
  }

  // --- Capteurs multi-canaux ------------------------------------------------
  for (const { block, type, read } of CHANNEL_BLOCKS) {
    for (const entry of live[block] ?? []) {
      const channel = toNumber(entry.channel);
      if (!channel) {
        continue;
      }
      addSensor(sensors, type, channel, read(entry), {
        ...inventory.forChannel(type, channel),
        battery: readLocalBattery(type, entry.battery),
      });
    }
  }

  return {
    stationId: inventory.stationId,
    model: null,
    receivedAt: new Date().toISOString(),
    sensors,
  };
}

/**
 * Client de l'API locale, avec un cache court.
 * Gladys déclenche `onPoll` par device : sans cette mutualisation, dix devices
 * créés produiraient dix requêtes à la passerelle à chaque cycle.
 *
 * @param {object} options
 * @param {string} options.ip adresse de la passerelle sur le LAN
 * @param {number} [options.cacheMs] durée de mutualisation des appels
 * @param {typeof fetch} [options.fetchImpl] injection pour les tests
 */
export function createLocalClient({ ip, cacheMs = 10_000, fetchImpl = fetch }) {
  let cached = null;
  let cachedAt = 0;
  let inFlight = null;

  async function get(path) {
    const response = await fetchImpl(`http://${ip}${path}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`${path} a répondu HTTP ${response.status}`);
    }
    return response.json();
  }

  async function refresh() {
    // `get_sensors_info` est absent de certains firmwares : son échec ne doit
    // pas priver l'utilisateur des mesures.
    const [live, sensorsInfo] = await Promise.all([
      get('/get_livedata_info'),
      get('/get_sensors_info').catch(() => null),
    ]);
    return buildObservation(live, sensorsInfo);
  }

  return {
    async getObservation() {
      if (cached && Date.now() - cachedAt < cacheMs) {
        return cached;
      }
      // Plusieurs `onPoll` simultanés se partagent la même requête.
      inFlight ??= refresh().finally(() => {
        inFlight = null;
      });
      cached = await inFlight;
      cachedAt = Date.now();
      return cached;
    },
    invalidate() {
      cached = null;
      cachedAt = 0;
    },
  };
}

// --- Utilitaires internes ----------------------------------------------------

/**
 * Indexe `get_sensors_info` pour retrouver l'identifiant matériel et le signal
 * d'un capteur. Les capteurs non appairés sont écartés.
 */
function indexSensors(sensorsInfo) {
  const entries = sensorsInfo?.sensor ?? [];
  const usable = entries.filter(
    (entry) => entry.id && !ABSENT_HARDWARE_IDS.has(String(entry.id).toUpperCase()),
  );

  const describe = (entry) => ({
    hardwareId: String(entry.id).toUpperCase(),
    signal: signalToPercent(entry.signal),
    battery: readLocalBattery(entry.img, entry.batt),
  });

  return {
    // À défaut de PASSKEY, l'identifiant matériel du capteur principal offre un
    // ancrage stable pour les external_id.
    stationId: usable.find((entry) => ['wh65', 'wh90', 'wh80'].includes(entry.img))?.id ?? null,

    forTypes(imgs) {
      const entry = usable.find((candidate) => imgs.includes(candidate.img));
      return entry ? describe(entry) : {};
    },

    forChannel(type, channel) {
      // `name` porte « ... CH3 » : c'est le seul lien entre l'inventaire et le
      // numéro de canal des blocs de mesures.
      const entry = usable.find(
        (candidate) =>
          candidate.img === type && new RegExp(`CH${channel}$`, 'i').test(candidate.name ?? ''),
      );
      return entry ? describe(entry) : {};
    },
  };
}

function addSensor(sensors, type, channel, values, extra = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      clean[key] = value;
    }
  }
  if (Object.keys(clean).length === 0) {
    return;
  }
  sensors.push({
    type,
    channel,
    hardwareId: extra.hardwareId ?? null,
    values: clean,
    battery: extra.battery ?? null,
    signal: extra.signal ?? null,
  });
}

function readTemperatureHumidity(entry) {
  return {
    temperature: readLocalValue(entry.temp, entry.unit),
    humidity: percent(entry.humidity),
  };
}

function readTemperatureOnly(entry) {
  return { temperature: readLocalValue(entry.temp, entry.unit) };
}

function readPm25(entry) {
  return {
    pm25: toNumber(entry.PM25),
    pm25Avg24h: toNumber(entry.PM25_24H ?? entry.PM25_24HAQI),
  };
}

/** « 65% » -> 65 ; « None » -> null. */
function percent(raw) {
  return toNumber(String(raw ?? '').replace('%', ''));
}

function toNumber(raw) {
  if (raw === undefined || raw === null || raw === '' || raw === 'None') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** L'API expose la qualité radio sur 0 à 4 ; Gladys attend un pourcentage. */
function signalToPercent(raw) {
  const value = toNumber(raw);
  return value === null ? null : Math.min(100, Math.max(0, value * 25));
}

function first(block) {
  return Array.isArray(block) && block.length > 0 ? block[0] : null;
}
