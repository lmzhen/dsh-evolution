## Ce que fait l’auto-évolution

Une session Harness ordinaire devient une session qui s’améliore seule : l’agent retient ce qu’il a appris, tient une bibliothèque de skills, passe son propre travail en revue, fusionne les skills en double et en assure la curation au fil du temps. Ses données restent dans votre dossier DSH ; les appels au modèle, eux, partent vers le fournisseur que vous avez configuré.

## Contenu

- Mémoire : un outil `memory` exposé au modèle, adossé à un stockage local en couches.
- Skills : l’outil `skill_manage`, un catalogue que l’agent peut charger et un atelier d’historique des skills.
- Revue et fusion : revue en arrière-plan, rédaction de skills en deux tours et une approbation de fusion que vous pouvez activer.
- Curation et maintenance : contrôles du cycle de vie, scans de dérive et une vue de santé en lecture seule, livrée désactivée.
- Commandes : `/evolution pending`, `curator`, `maintain` et `doctor` fonctionnent dans toute session, avec ou sans panneau.

## Où le configurer

Chaque paramètre modifiable relève du composant qui le porte : le panneau y affiche la valeur active, la valeur par défaut livrée et si vous l’avez modifiée. La plupart des modifications s’appliquent immédiatement ; quelques réglages de déploiement demandent un redémarrage. Les paramètres que vous ne touchez pas restent à leur valeur par défaut.

## Remarques

Les écritures ordinaires de mémoire et de skills sont approuvées automatiquement, sauf si vous activez l’approbation d’écriture : dans ce cas, chacune prépare une entrée en attente que vous approuvez ou refusez avant qu’elle ne s’applique. La vue de santé est livrée désactivée. La fusion de skills a son propre réglage d’approbation, distinct de celui des écritures, et laisse un reçu permettant d’annuler la fusion.
