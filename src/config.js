// -----------------------------------------------------------------------------
// Configuration de l'intégration.
//
// Remplie par l'utilisateur depuis le `config_schema` du manifeste, récupérée
// par le SDK (`getConfig`) et rafraîchie par `onConfigUpdated`. Ce module ne
// fait que normaliser, pour que le reste du code n'ait jamais à gérer
// `undefined`.
//
// Les valeurs par défaut DOIVENT rester alignées sur les `default` du
// manifeste : un test le vérifie.
// -----------------------------------------------------------------------------

export const MODES = {
  AUTO: 'auto',
  PUSH: 'push',
  LOCAL: 'local',
};

export const DEFAULT_CONFIG = {
  // `auto` bascule en polling dès qu'une adresse de passerelle est renseignée,
  // et reste en réception push sinon.
  mode: MODES.AUTO,
  gateway_ip: '',
  poll_frequency: 60,
  // Filtre facultatif : n'accepter que les relevés de CETTE station. Le port du
  // receiver est publié sur le LAN, donc ouvert à tout envoi.
  station_passkey: '',
};

// Intervalles (en secondes) que le cœur de Gladys accepte sur un device
// publié : il valide `poll_frequency` EN MILLISECONDES contre l'ensemble fermé
// [1000, 2000, 10000, 15000, 30000, 60000], et rejette toute la publication
// sinon. En deçà de 30 s, on interrogerait la passerelle plus souvent qu'elle
// ne rafraîchit ses mesures : seules 30 et 60 s sont retenues. Même correctif
// que gladys-tp-link (src/config.js).
const POLL_FREQUENCIES_SECONDS = [30, 60];

/**
 * Ramène un intervalle à la valeur acceptée la plus proche. Une valeur saisie
 * avant la correction (le champ allait jusqu'à 3600 s) reste ainsi valable.
 */
function nearestPollFrequency(raw) {
  // Seuls un nombre ou une chaîne numérique ont un sens : `Number(true)` vaut 1
  // et `Number('')` vaut 0, deux valeurs à ne pas confondre avec un choix.
  const seconds = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  if (raw === '' || !Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_CONFIG.poll_frequency;
  }
  // `<=` : à égale distance (45 s), le plus lent l'emporte.
  return POLL_FREQUENCIES_SECONDS.reduce((closest, candidate) =>
    Math.abs(candidate - seconds) <= Math.abs(closest - seconds) ? candidate : closest,
  );
}

export function normalizeConfig(raw = {}) {
  const mode = Object.values(MODES).includes(raw.mode) ? raw.mode : DEFAULT_CONFIG.mode;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    mode,
    gateway_ip: String(raw.gateway_ip ?? '').trim(),
    station_passkey: String(raw.station_passkey ?? '').trim(),
    poll_frequency: nearestPollFrequency(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency),
  };
}

/**
 * Mode réellement appliqué.
 *
 * Les deux sources ne produisent pas les mêmes identifiants (l'API locale
 * fournit l'identifiant matériel des capteurs, pas le protocole push) : les
 * mélanger sur une même station créerait des devices en double. Le mode est
 * donc exclusif.
 */
export function resolveMode(config) {
  if (config.mode === MODES.AUTO) {
    return config.gateway_ip ? MODES.LOCAL : MODES.PUSH;
  }
  return config.mode;
}
