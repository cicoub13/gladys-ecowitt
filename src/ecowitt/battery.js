// -----------------------------------------------------------------------------
// Batteries Ecowitt.
//
// Le piège de cette intégration : pour UN MÊME capteur, l'encodage de la
// batterie diffère selon la source.
//   - WH51 (humidité du sol) : tension en volts dans le protocole push,
//     simple drapeau 0/1 dans `get_sensors_info`.
//   - Les valeurs de l'API locale sont brutes : la tension s'obtient en
//     multipliant par 0,02 V (documentation officielle « HTTP API interface »).
// D'où deux tables, et surtout jamais de règle globale.
//
// Choix produit : on ne fabrique pas de pourcentage à partir d'une tension.
// Une tension donne un état « batterie faible » au seuil documenté par
// Ecowitt ; seuls les capteurs qui publient un niveau 0-5 donnent un
// pourcentage (le constructeur définit lui-même ces paliers de 20 %).
// -----------------------------------------------------------------------------

/** Seuil officiel Ecowitt de tension basse, pour les capteurs sur piles. */
const LOW_VOLTAGE_THRESHOLD = 1.2;

/** Facteur de conversion des tensions brutes de `get_sensors_info`. */
const RAW_VOLTAGE_STEP = 0.02;

/**
 * Stratégies, protocole push (clés `*batt*` du POST).
 * L'ordre compte : la première expression qui correspond gagne.
 */
const PUSH_STRATEGIES = [
  // Drapeau 0 = normal, 1 = batterie faible.
  { pattern: /^(wh25|wh26|wh65|wh24|wh32)batt$/, strategy: 'flag' },
  { pattern: /^batt\d+$/, strategy: 'flag' }, // WH31, canaux 1 à 8
  // Niveau 0-5 défini par le constructeur, converti en paliers de 20 %.
  { pattern: /^(pm25batt\d+|leakbatt\d+|wh57batt|co2_batt|wh90battpc)$/, strategy: 'level' },
  // Tension en volts, déjà convertie par la station.
  { pattern: /^(soilbatt\d+|tf_batt\d+|leaf_batt\d+)$/, strategy: 'volt' },
  { pattern: /^(wh40|wh68|wh80|wh90|wh85)batt$/, strategy: 'volt-unknown-threshold' },
  { pattern: /^ws90cap_volt$/, strategy: 'volt-unknown-threshold' },
];

/**
 * Stratégies, API locale (`get_sensors_info`), indexées par le champ `img`
 * qui identifie le modèle de capteur.
 */
const LOCAL_STRATEGIES = {
  wh65: 'flag',
  wh25: 'flag',
  wh26: 'flag',
  wh31: 'flag',
  wh51: 'flag',
  // Tension brute (× 0,02 V), seuil bas documenté à 1,2 V.
  wh68: 'raw-volt',
  wh34: 'raw-volt',
  wh35: 'raw-volt',
  wh54: 'raw-volt',
  // Tension brute réelle, sans seuil documenté par Ecowitt (capteurs solaires
  // à supercondensateur : 1,2 V n'aurait aucun sens pour eux).
  wh80: 'raw-volt-unknown-threshold',
  wh40: 'raw-volt-unknown-threshold',
  wh90: 'raw-volt-unknown-threshold',
  wh85: 'raw-volt-unknown-threshold',
  // Niveau 0-5, batterie faible annoncée à 1 ou moins.
  wh41: 'level',
  wh57: 'level',
  wh55: 'level',
  wh45: 'level',
};

/** Valeur renvoyée par `get_sensors_info` pour un capteur non appairé. */
const ABSENT_BATTERY_VALUE = '9';

/**
 * @typedef {object} BatteryReading
 * @property {'low'|'percent'} kind forme exploitable par Gladys
 * @property {boolean} [low] état « batterie faible » (kind === 'low')
 * @property {number} [percent] niveau en pourcentage (kind === 'percent')
 */

/**
 * Interprète une valeur de batterie du protocole push.
 * @param {string} key clé du POST, par exemple `soilbatt1`
 * @param {string|number} rawValue valeur associée
 * @returns {BatteryReading|null} null si la clé est inconnue ou inexploitable
 */
export function readPushBattery(key, rawValue) {
  const entry = PUSH_STRATEGIES.find(({ pattern }) => pattern.test(key));
  if (!entry) {
    return null;
  }
  return interpret(entry.strategy, rawValue);
}

/**
 * Interprète le champ `batt` d'une entrée de `get_sensors_info`.
 * @param {string} img modèle du capteur, par exemple `wh51`
 * @param {string|number} rawValue valeur du champ `batt`
 */
export function readLocalBattery(img, rawValue) {
  if (String(rawValue) === ABSENT_BATTERY_VALUE) {
    return null; // capteur non appairé
  }
  const strategy = LOCAL_STRATEGIES[String(img ?? '').toLowerCase()];
  if (!strategy) {
    return null;
  }
  return interpret(strategy, rawValue);
}

function interpret(strategy, rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return null;
  }
  switch (strategy) {
    case 'flag':
      return { kind: 'low', low: value === 1 };

    case 'level':
      // 0 à 5 ; 6 signale une alimentation secteur, d'où le plafonnement.
      return { kind: 'percent', percent: Math.min(100, Math.max(0, value * 20)) };

    case 'volt':
      return { kind: 'low', low: value <= LOW_VOLTAGE_THRESHOLD };

    case 'raw-volt':
      return { kind: 'low', low: value * RAW_VOLTAGE_STEP <= LOW_VOLTAGE_THRESHOLD };

    // Ecowitt publie la tension sans documenter de seuil pour ces capteurs :
    // on préfère ne rien afficher plutôt qu'un seuil inventé.
    case 'volt-unknown-threshold':
    case 'raw-volt-unknown-threshold':
      return null;

    default:
      return null;
  }
}

export const BATTERY_INTERNALS = { LOW_VOLTAGE_THRESHOLD, RAW_VOLTAGE_STEP, ABSENT_BATTERY_VALUE };
