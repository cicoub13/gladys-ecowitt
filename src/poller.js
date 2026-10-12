// -----------------------------------------------------------------------------
// Boucle d'interrogation propre à l'intégration (mode local).
//
// Le cœur de Gladys ne planifie `onPoll` que pour les devices publiés avec
// `should_poll: true`, ce que cette intégration n'a jamais fait : aucun device
// créé n'était interrogé, et les relevés n'arrivaient qu'au scan ou au test de
// réception. Ajouter ce drapeau n'atteindrait pas les devices déjà créés
// (Gladys ne propose « Mettre à jour » dans Découverte que si les features
// changent) : l'intégration lit donc elle-même la passerelle, UNE fois par
// intervalle, quel que soit le nombre de devices. Même correctif que
// gladys-tp-link (src/poller.js).
//
// Un tick qui tombe pendant la lecture précédente est sauté : deux lectures ne
// se chevauchent jamais. Un échec est seulement journalisé : il n'arrête pas
// la boucle.
// -----------------------------------------------------------------------------

import { logger } from '@gladysassistant/integration-sdk';

/**
 * @param {object} options
 * @param {() => Promise<void>} options.run une lecture de la passerelle
 * @returns {{ start: (seconds: number) => Promise<void>, stop: () => void }}
 */
export function createPoller({ run }) {
  let timer = null;
  let running = false;

  /** Une lecture, sauf si la précédente court encore. Ne rejette jamais. */
  async function runOnce() {
    if (running) {
      logger.debug('Lecture précédente de la passerelle en cours, tick sauté');
      return;
    }
    running = true;
    try {
      await run();
    } catch (err) {
      logger.warn(`Lecture périodique de la passerelle impossible (${err.message})`);
    } finally {
      running = false;
    }
  }

  /** Arrête la boucle ; une lecture en cours se termine sans rien replanifier. */
  function stop() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  /**
   * (Ré)arme la boucle : une lecture tout de suite, puis toutes les `seconds`.
   * @returns {Promise<void>} résolue une fois la première lecture terminée
   */
  function start(seconds) {
    stop();
    timer = setInterval(runOnce, seconds * 1000);
    return runOnce();
  }

  return { start, stop };
}
