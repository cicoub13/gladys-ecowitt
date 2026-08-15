// -----------------------------------------------------------------------------
// Découverte des passerelles sur le LAN.
//
// Les passerelles Ecowitt s'annoncent d'elles-mêmes en broadcast UDP sur le
// port 46000, toutes les deux secondes. Un conteneur d'intégration ne reçoit
// aucun broadcast (réseau bridge) : c'est le cœur de Gladys qui capture, et
// l'intégration qui interprète — `scanNetwork` rend les datagrammes bruts.
//
// Trame de l'annonce :
//   0xFF 0xFF 0x12 <taille> <MAC:6> <IP:4> <port:2> <len> <nom...> <somme>
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'discovery' });

export const DISCOVERY_PORT = 46000;

/** En-tête d'une annonce Ecowitt : deux octets 0xFF puis la commande 0x12. */
const HEADER = [0xff, 0xff, 0x12];

/** Position des champs, l'en-tête et l'octet de taille consommés. */
const MAC_OFFSET = 4;
const IP_OFFSET = 10;
const PORT_OFFSET = 14;
const NAME_LENGTH_OFFSET = 16;

/**
 * Décode une annonce de passerelle.
 * @param {Buffer} payload datagramme brut
 * @returns {{ mac: string, ip: string, port: number, name: string }|null}
 */
export function decodeAnnouncement(payload) {
  if (!Buffer.isBuffer(payload) || payload.length < NAME_LENGTH_OFFSET + 1) {
    return null;
  }
  if (HEADER.some((byte, index) => payload[index] !== byte)) {
    return null; // ce n'est pas une annonce Ecowitt
  }

  const mac = [...payload.subarray(MAC_OFFSET, MAC_OFFSET + 6)]
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
  const ip = [...payload.subarray(IP_OFFSET, IP_OFFSET + 4)].join('.');
  const port = payload.readUInt16BE(PORT_OFFSET);

  const nameLength = payload[NAME_LENGTH_OFFSET];
  const nameStart = NAME_LENGTH_OFFSET + 1;
  const name = payload.subarray(nameStart, nameStart + nameLength).toString('ascii');

  return { mac, ip, port, name };
}

/**
 * Cherche les passerelles joignables sur le LAN.
 * @param {object} gladys instance du SDK
 * @param {number} [timeoutSeconds] durée d'écoute
 * @returns {Promise<{ mac: string, ip: string, name: string }[]>}
 */
export async function scanGateways(gladys, timeoutSeconds = 6) {
  let datagrams;
  try {
    datagrams = await gladys.scanNetwork('udp-broadcast', { timeoutSeconds });
  } catch (err) {
    logger.warn(`Scan réseau indisponible (${err.message})`);
    return [];
  }

  const byMac = new Map();
  for (const { source_ip: sourceIp, payload_base64: payloadBase64 } of datagrams) {
    const announcement = decodeAnnouncement(Buffer.from(payloadBase64, 'base64'));
    if (!announcement) {
      continue;
    }
    // L'adresse annoncée peut être obsolète après un changement de bail DHCP ;
    // celle d'où vient le datagramme, elle, est forcément la bonne.
    byMac.set(announcement.mac, { ...announcement, ip: sourceIp || announcement.ip });
  }

  const gateways = [...byMac.values()];
  logger.info(`${gateways.length} passerelle(s) Ecowitt détectée(s)`);
  return gateways;
}
