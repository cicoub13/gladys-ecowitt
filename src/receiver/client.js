// -----------------------------------------------------------------------------
// Client du receiver, côté conteneur principal.
//
// Les deux conteneurs partagent le réseau bridge privé de l'intégration, sur
// lequel Gladys donne au sous-conteneur un alias DNS égal à son nom déclaré au
// manifeste : `http://receiver:8080` suffit, sans avoir à connaître le port
// alloué sur l'hôte.
//
// Le flux SSE est rejoué à la connexion (le receiver conserve le dernier
// relevé), donc une coupure ne fait pas attendre le prochain envoi de la
// station.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'receiver-client' });

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * @param {object} options
 * @param {string} options.baseUrl racine du receiver, par exemple `http://receiver:8080`
 * @param {(reading: object) => Promise<void>|void} options.onReading appelé à chaque relevé
 */
export function createReceiverClient({ baseUrl, onReading }) {
  let stopped = false;
  let controller = null;
  let retryDelay = INITIAL_RETRY_MS;

  async function connect() {
    controller = new AbortController();
    const response = await fetch(`${baseUrl}/events`, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    });
    if (!response.ok || !response.body) {
      throw new Error(`flux refusé (HTTP ${response.status})`);
    }
    logger.info('Connecté au flux du receiver');
    retryDelay = INITIAL_RETRY_MS;

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      // Les événements SSE sont séparés par une ligne vide.
      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        await handleEvent(rawEvent);
        separator = buffer.indexOf('\n\n');
      }
    }
    throw new Error('flux interrompu par le receiver');
  }

  async function handleEvent(rawEvent) {
    const data = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    if (!data) {
      return; // commentaire de maintien de connexion
    }
    try {
      await onReading(JSON.parse(data));
    } catch (err) {
      logger.error('Traitement du relevé impossible', err);
    }
  }

  async function loop() {
    while (!stopped) {
      try {
        await connect();
      } catch (err) {
        if (stopped) {
          return;
        }
        logger.warn(`Flux du receiver indisponible (${err.message}), nouvel essai`);
      }
      if (stopped) {
        return;
      }
      await sleep(retryDelay);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
    }
  }

  return {
    start() {
      stopped = false;
      loop();
    },
    stop() {
      stopped = true;
      controller?.abort();
    },
    /** État du receiver, pour l'action « Tester la réception ». */
    async status() {
      const response = await fetch(`${baseUrl}/health`);
      if (!response.ok) {
        throw new Error(`receiver injoignable (HTTP ${response.status})`);
      }
      return response.json();
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
