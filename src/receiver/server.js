// -----------------------------------------------------------------------------
// Receiver : le point d'entrée HTTP des stations Ecowitt.
//
// Il tourne dans un SOUS-CONTENEUR, seul endroit où Gladys autorise la
// publication d'un port sur le LAN. Ce conteneur n'a ni jeton ni accès à l'API
// hôte : il reçoit, mémorise, et diffuse. Toute la logique Gladys reste dans le
// conteneur principal, qui consomme le flux via l'alias DNS du réseau privé.
//
// Deux ports, deux publics :
//   - le port PUBLIÉ (déclaré au manifeste) ne reçoit que les envois des
//     stations. Tout le LAN y a accès : il ne révèle rien.
//   - le port INTERNE (non publié) sert le flux et l'état au conteneur
//     principal, seul à le joindre par le réseau privé de l'intégration.
//
// Aucune dépendance : `node:http` suffit, et le rootfs est en lecture seule.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'receiver' });

/** Au-delà, ce n'est plus un relevé météo : on coupe. */
const MAX_BODY_BYTES = 64 * 1024;

/** Intervalle des commentaires SSE qui maintiennent la connexion ouverte. */
const SSE_KEEPALIVE_MS = 25_000;

/** Chemin utilisé par le protocole Wunderground. */
const WUNDERGROUND_PATH = '/weatherstation/updateweatherstation.php';

/**
 * Démarre le receiver.
 *
 * @param {object} options
 * @param {number} [options.port] port d'écoute des stations, publié sur le LAN
 * @param {number} [options.internalPort] port du flux, réservé au conteneur principal
 * @returns {Promise<{ close: () => Promise<void>, port: number, internalPort: number }>}
 */
export async function startReceiver({ port = 8080, internalPort = 8081 } = {}) {
  /** @type {Set<import('node:http').ServerResponse>} */
  const subscribers = new Set();
  let lastReading = null;
  let receivedCount = 0;

  const broadcast = (reading) => {
    const frame = `data: ${JSON.stringify(reading)}\n\n`;
    for (const subscriber of subscribers) {
      subscriber.write(frame);
    }
  };

  // --- Port publié : les envois des stations ---------------------------------
  const uploadServer = http.createServer(
    safely(async (req, res, url) => {
      // --- Protocole Wunderground : tout est dans la query string -----------
      if (req.method === 'GET' && url.pathname === WUNDERGROUND_PATH) {
        const query = Object.fromEntries(url.searchParams);
        // La clé de station Wunderground est souvent la vraie : elle ne sert
        // à rien ici et ne doit ni être mémorisée ni circuler.
        delete query.PASSWORD;
        const reading = record('wunderground', query);
        broadcast(reading);
        // La station attend cette réponse exacte, sinon elle signale une erreur.
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('success\n');
        return;
      }

      // --- Protocole Ecowitt : POST formulaire -------------------------------
      // Volontairement tolérant sur le chemin : l'application WSView Plus laisse
      // l'utilisateur le saisir librement, et une faute de frappe y produirait
      // sinon un silence complet, très difficile à diagnostiquer.
      if (req.method === 'POST') {
        let body;
        try {
          body = await readBody(req);
        } catch (err) {
          logger.warn(`Corps de requête rejeté (${err.message})`);
          res.writeHead(413).end();
          return;
        }
        const reading = record('ecowitt', Object.fromEntries(new URLSearchParams(body)));
        broadcast(reading);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('OK\n');
        return;
      }

      res.writeHead(404).end();
    }),
  );

  // --- Port interne : le conteneur principal ---------------------------------
  const internalServer = http.createServer(
    safely(async (req, res, url) => {
      // --- Flux temps réel ---------------------------------------------------
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        // Envoyer les en-têtes tout de suite : sans relevé à rejouer, le client
        // ne saurait sinon qu'il est connecté qu'au premier maintien (25 s).
        res.flushHeaders();
        // Rejouer le dernier relevé : le conteneur principal qui se (re)connecte
        // n'a pas à attendre le prochain envoi de la station, qui peut être à
        // plusieurs minutes.
        if (lastReading) {
          res.write(`data: ${JSON.stringify(lastReading)}\n\n`);
        }
        subscribers.add(res);
        req.on('close', () => subscribers.delete(res));
        return;
      }

      // --- État, pour l'action « Tester la réception » ----------------------
      if (req.method === 'GET' && (url.pathname === '/last' || url.pathname === '/health')) {
        sendJson(res, 200, {
          receivedCount,
          subscribers: subscribers.size,
          last: lastReading,
        });
        return;
      }

      res.writeHead(404).end();
    }),
  );

  function record(protocol, payload) {
    receivedCount += 1;
    lastReading = { protocol, payload, receivedAt: new Date().toISOString() };
    logger.debug(`Relevé ${protocol} reçu (${Object.keys(payload).length} champs)`);
    return lastReading;
  }

  // Empêche les connexions SSE inactives d'être coupées par un intermédiaire.
  const keepAlive = setInterval(() => {
    for (const subscriber of subscribers) {
      subscriber.write(': keep-alive\n\n');
    }
  }, SSE_KEEPALIVE_MS);
  keepAlive.unref();

  await listen(uploadServer, port);
  await listen(internalServer, internalPort);
  logger.info(`Receiver à l'écoute sur le port ${port} (flux interne sur le port ${internalPort})`);

  return {
    port,
    internalPort,
    close: async () => {
      clearInterval(keepAlive);
      for (const subscriber of subscribers) {
        subscriber.end();
      }
      subscribers.clear();
      await Promise.all([close(uploadServer), close(internalServer)]);
    },
  };
}

/**
 * Enveloppe un gestionnaire de requêtes. Une requête inattendue ne doit
 * jamais devenir une promesse rejetée non gérée, qui arrêterait le processus.
 */
function safely(handler) {
  return (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://receiver');
    } catch {
      res.writeHead(400).end(); // chemin illisible, par exemple « // »
      return;
    }
    handler(req, res, url).catch((err) => {
      logger.warn(`Requête ${req.method} ${url.pathname} en échec (${err.message})`);
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end();
    });
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('corps trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
