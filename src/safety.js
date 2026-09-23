// -----------------------------------------------------------------------------
// Filet de sécurité du processus, commun aux deux rôles de l'image.
//
// Une promesse rejetée que personne n'attend laisse le processus dans un état
// inconnu. On journalise la cause (sinon Node n'imprime qu'une pile sans
// contexte) puis on s'arrête : le superviseur de Gladys redémarre le conteneur.
// Les causes connues sont corrigées à la source ; ceci ne couvre que l'imprévu.
// -----------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {{ error: Function }} options.logger journal du rôle courant
 * @param {(code: number) => void} [options.exit] injection pour les tests
 * @returns {(reason: unknown) => void} le gestionnaire installé
 */
export function exitOnUnhandledRejection({ logger, exit = (code) => process.exit(code) }) {
  const handler = (reason) => {
    logger.error('Promesse rejetée non gérée, arrêt pour redémarrage par le superviseur', reason);
    exit(1);
  };
  process.on('unhandledRejection', handler);
  return handler;
}
