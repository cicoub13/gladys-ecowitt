// -----------------------------------------------------------------------------
// Point d'entrée, partagé par les deux rôles de la MÊME image Docker.
//
//   node index.js             -> l'intégration : dialogue avec Gladys (SDK)
//   node index.js --receiver  -> le receiver : écoute les envois des stations
//
// Pourquoi deux conteneurs : Gladys n'autorise la publication d'un port sur le
// LAN que pour un sous-conteneur. Le conteneur principal, lui, est le seul à
// détenir le jeton d'accès à l'API hôte. Une seule image sert les deux rôles,
// ce qui évite d'en publier et d'en versionner une seconde.
// -----------------------------------------------------------------------------

import { logger } from '@gladysassistant/integration-sdk';
import { exitOnUnhandledRejection } from './src/safety.js';

exitOnUnhandledRejection({ logger });

const isReceiver = process.argv.includes('--receiver') || process.env.ECOWITT_ROLE === 'receiver';

if (isReceiver) {
  const { startReceiver } = await import('./src/receiver/server.js');
  const port = Number(process.env.ECOWITT_RECEIVER_PORT ?? 8080);
  const internalPort = Number(process.env.ECOWITT_RECEIVER_INTERNAL_PORT ?? 8081);
  const receiver = await startReceiver({ port, internalPort });

  const shutdown = async (signal) => {
    logger.info(`Signal ${signal} reçu, arrêt du receiver`);
    await receiver.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} else {
  const { startIntegration } = await import('./src/integration.js');
  logger.info("Démarrage de l'intégration Ecowitt...");
  try {
    await startIntegration();
  } catch (err) {
    // Le SDK ne rejette que sur un jeton refusé à la première connexion, et
    // garde sa boucle de reconnexion armée : ce refus peut être passager
    // (Gladys qui démarre). Quitter ici transformerait ce délai en redémarrage
    // du conteneur ; on reste en vie et le SDK retente.
    logger.error(`Connexion initiale refusée (${err.message}), nouvel essai automatique`, err);
  }
}
