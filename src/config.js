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

export function normalizeConfig(raw = {}) {
  const mode = Object.values(MODES).includes(raw.mode) ? raw.mode : DEFAULT_CONFIG.mode;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    mode,
    gateway_ip: String(raw.gateway_ip ?? '').trim(),
    station_passkey: String(raw.station_passkey ?? '').trim(),
    poll_frequency: Number(raw.poll_frequency ?? DEFAULT_CONFIG.poll_frequency),
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
