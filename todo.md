# Toilet Manager — TODO

## Objectif
Un site React + TypeScript et une API Node.js / SQLite pour consulter et signaler anonymement l'état des toilettes, directement sur un plan cliquable.

## Fonctionnalités
- [x] Examiner la photo `plan.png` et redessiner le plan du 3e étage en SVG.
- [x] Représenter les deux blocs nord/sud, le patio, les escaliers et les dix cabines visibles : bloc sud hommes, bloc nord inversé selon l'affectation confirmée.
- [x] Sélectionner les WC directement sur le plan, sans combobox, à la souris ou au clavier, avec zoom jusqu'à 300 % sur mobile.
- [x] Afficher les états colorés, leur légende et le détail de chaque WC, avec dégradation automatique de la couleur selon le temps restant.
- [x] Ajouter les alertes temporaires : petite brise **15 min**, nuage suspect **30 min**, zone toxique **60 min**, radioactif **90 min**.
- [x] Afficher un compte à rebours synchronisé avec l'heure du serveur.
- [x] Garder le niveau et l'échéance les plus élevés lors de signalements atmosphériques concurrents.
- [x] Gérer séparément la propreté : propre, dégradé, dangereux, critique.
- [x] Conserver la propreté jusqu'à minuit ou un nouveau signalement de propreté, sans expiration avec l'atmosphère.
- [x] Tout réinitialiser à **00h00 Europe/Paris**, y compris les alertes radioactives, avec prise en compte des changements d'heure et redémarrages.
- [x] Persister uniquement les états courants dans SQLite, sans compte, nom, cookie ou historique des signalements.
- [x] Partager les états via l'API et actualiser les autres clients toutes les 10 secondes.
- [x] Prévoir les erreurs réseau, l'aide et une présentation mobile.
- [x] Ajouter des animations et des sons locaux adaptés à chaque signalement enregistré, avec bouton muet et respect de la réduction des mouvements.
- [x] Ajouter un favicon SVG assorti au site.
- [x] Refaire la direction artistique en bulletin météo TV (carte météo, prévisions par cabine, bandeau d'alertes, flash spécial).
- [x] Remplacer les bips par des bruitages : chasse d'eau, prouts, mouches, compteur Geiger, ventouse, toc toc.
- [x] PWA installable (manifeste, icônes, service worker) et notifications Web Push à chaque signalement, bon ou mauvais.

## Livraison et validation
- [x] Installer les dépendances et vérifier le typage / build de production.
- [x] Tester les durées, la persistance, les entrées API, la remise à zéro, les changements d'heure et les retours sonores : **14 tests réussis**.
- [x] Vérifier dans le navigateur les sons, animations, mode muet, réduction des mouvements, favicon et absence d'effet après une erreur API, sans créer de signalements de test en base.
- [x] Vérifier le parcours utilisateur dans un navigateur : signalements, couleurs prioritaires, compte à rebours, partage entre clients, rechargement, propreté indépendante, sélection au clavier, aide et zoom mobile sans débordement.
- [x] Documenter l'installation, l'API, l'anonymat et les règles.

## À confirmer sur place
- [ ] Vérifier le nombre exact et l'affectation des cabines, ainsi que les pictogrammes PMR : ils sont interprétés depuis la photo, pas depuis un relevé architectural.
- [ ] Avant une publication Internet, prévoir HTTPS, une limitation globale des requêtes et vérifier les journaux du serveur mandataire pour préserver l'anonymat.
