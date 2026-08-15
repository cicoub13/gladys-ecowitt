// -----------------------------------------------------------------------------
// Publication des états, dédupliquée.
//
// L'API hôte limite à 300 états par minute et par intégration. Une station
// complète expose 40 à 60 fonctionnalités et l'intervalle d'envoi d'Ecowitt
// descend à 16 secondes : sans déduplication on dépasserait le quota, alors que
// la plupart des mesures ne bougent pas d'un envoi à l'autre. Elle n'est donc
// pas une optimisation, mais une condition de fonctionnement.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'publisher' });

/** Taille maximale d'un lot accepté par `publishStates`. */
const BATCH_SIZE = 100;

export function createPublisher(gladys) {
  /** Dernière valeur publiée, par fonctionnalité. */
  const lastValues = new Map();

  return {
    /**
     * Publie uniquement les valeurs qui ont changé.
     * @param {{ device_feature_external_id: string, state: number }[]} states
     * @returns {Promise<number>} nombre d'états réellement envoyés
     */
    async publish(states) {
      const changed = states.filter(
        ({ device_feature_external_id: id, state }) => lastValues.get(id) !== state,
      );
      if (changed.length === 0) {
        return 0;
      }

      for (let index = 0; index < changed.length; index += BATCH_SIZE) {
        const batch = changed.slice(index, index + BATCH_SIZE);
        await gladys.publishStates(batch);
        // On ne mémorise qu'après l'envoi : un lot en échec sera réessayé au
        // relevé suivant plutôt que considéré comme déjà publié.
        for (const { device_feature_external_id: id, state } of batch) {
          lastValues.set(id, state);
        }
      }

      logger.debug(`${changed.length} état(s) publié(s) sur ${states.length}`);
      return changed.length;
    },

    /**
     * Oublie les valeurs mémorisées. À appeler à la reconnexion : Gladys
     * resynchronise son état, et les valeurs doivent être republiées.
     */
    reset() {
      lastValues.clear();
    },
  };
}
