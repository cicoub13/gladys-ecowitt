// -----------------------------------------------------------------------------
// Protocole Wunderground, en repli.
//
// Certaines consoles anciennes ne proposent que ce protocole dans leur écran
// « Customized ». Il transporte moins de mesures que le protocole Ecowitt
// (pas de multi-canal, ni PM2.5, ni CO2, ni foudre) mais couvre l'essentiel.
//
// Plutôt que de dupliquer le mapping, on renomme les champs vers le
// vocabulaire Ecowitt et on réutilise l'adaptateur push tel quel.
// -----------------------------------------------------------------------------

/** Clé Wunderground -> clé Ecowitt équivalente. */
const FIELD_ALIASES = {
  ID: 'PASSKEY',
  softwaretype: 'stationtype',
  tempf: 'tempf',
  humidity: 'humidity',
  dewptf: 'dewptf',
  windchillf: 'windchillf',
  winddir: 'winddir',
  windspeedmph: 'windspeedmph',
  windgustmph: 'windgustmph',
  solarradiation: 'solarradiation',
  UV: 'uv',
  indoortempf: 'tempinf',
  indoorhumidity: 'humidityin',
  baromin: 'baromrelin',
  // Wunderground nomme « rainin » le cumul de la dernière heure.
  rainin: 'hourlyrainin',
  dailyrainin: 'dailyrainin',
  weeklyrainin: 'weeklyrainin',
  monthlyrainin: 'monthlyrainin',
  yearlyrainin: 'yearlyrainin',
};

/**
 * Traduit une requête Wunderground en payload au format Ecowitt.
 * @param {Record<string, string>} query paramètres de la query string
 */
export function toEcowittPayload(query) {
  const payload = {};
  for (const [source, target] of Object.entries(FIELD_ALIASES)) {
    if (query[source] !== undefined && query[source] !== '') {
      payload[target] = query[source];
    }
  }
  return payload;
}
