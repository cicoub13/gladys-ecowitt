// -----------------------------------------------------------------------------
// Conversions d'unités.
//
// Deux sources, deux régimes d'unités :
//   - protocole push « Custom Server » : unités impériales FIXES (°F, inHg,
//     mph, in) quels que soient les réglages de la station. La conversion est
//     donc déterministe.
//   - API HTTP locale : les valeurs arrivent avec leur unité dans la chaîne
//     (« 0.00 mph », « 79.2 » + unit « F »), et cette unité suit les réglages
//     de l'utilisateur. Il faut la lire, jamais la supposer.
// -----------------------------------------------------------------------------

/** Arrondi à `digits` décimales, sans le bruit de la virgule flottante. */
export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export const fahrenheitToCelsius = (f) => ((f - 32) * 5) / 9;
export const inHgToHectoPascal = (inHg) => inHg * 33.863886;
export const mphToKmh = (mph) => mph * 1.609344;
export const inchToMm = (inch) => inch * 25.4;
export const mileToKm = (mile) => mile * 1.609344;

// Ecowitt publie l'ensoleillement en W/m². Gladys n'accepte que des lux sur la
// catégorie `light-sensor`. Le facteur 126,7 est la convention retenue par
// Ecowitt et Home Assistant pour la lumière solaire — c'est une approximation
// spectrale, pas une identité physique.
export const wattPerSquareMeterToLux = (w) => w * 126.7;

/**
 * Convertit un nombre vers l'unité métrique attendue par Gladys.
 * L'unité est celle annoncée par la source ; une unité déjà métrique est
 * renvoyée telle quelle.
 */
export function toMetric(value, unit) {
  if (!Number.isFinite(value)) {
    return null;
  }
  switch (normalizeUnitLabel(unit)) {
    case 'f':
      return fahrenheitToCelsius(value);
    case 'inhg':
      return inHgToHectoPascal(value);
    case 'mph':
      return mphToKmh(value);
    case 'in':
    case 'in/hr':
      return inchToMm(value);
    case 'mi':
      return mileToKm(value);
    default:
      // c, hpa, mmhg exclu, km/h, m/s, mm, mm/hr, %, w/m2, lux, ppm...
      return value;
  }
}

/** Met une étiquette d'unité sous forme canonique : « in/Hr » -> « in/hr ». */
function normalizeUnitLabel(unit) {
  return String(unit ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Découpe une valeur de l'API locale en nombre + unité.
 * L'API mélange les deux formes : « 0.00 mph » (unité collée à la valeur) et
 * « 79.2 » accompagné d'un champ `unit` séparé.
 *
 * @param {string|number} raw valeur brute
 * @param {string} [fallbackUnit] unité du champ `unit` voisin, si présent
 * @returns {{ value: number|null, unit: string }}
 */
export function parseValueWithUnit(raw, fallbackUnit = '') {
  if (typeof raw === 'number') {
    return { value: raw, unit: normalizeUnitLabel(fallbackUnit) };
  }
  const text = String(raw ?? '').trim();
  // Un nombre en tête, le reste est l'unité éventuelle.
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) {
    return { value: null, unit: normalizeUnitLabel(fallbackUnit) };
  }
  const [, numberPart, unitPart] = match;
  return {
    value: Number(numberPart),
    unit: normalizeUnitLabel(unitPart || fallbackUnit),
  };
}

/** Lit un champ de l'API locale et le renvoie converti en métrique. */
export function readLocalValue(raw, fallbackUnit = '', digits = 2) {
  const { value, unit } = parseValueWithUnit(raw, fallbackUnit);
  if (value === null) {
    return null;
  }
  return round(toMetric(value, unit), digits);
}

/** Lit un champ du protocole push, dont l'unité est connue par construction. */
export function readPushValue(raw, unit, digits = 2) {
  // `Number('')` vaut 0 et `Number(null)` aussi : sans cette garde, un champ
  // vide serait publié comme une vraie mesure (0 °F, soit -17,8 °C).
  if (raw === '' || raw === null || raw === undefined) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return round(toMetric(value, unit), digits);
}
