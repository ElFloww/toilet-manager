# Toilet Manager

La météo anonyme des toilettes : plan SVG interactif redessiné depuis [la photo](plan.png), front React / TypeScript, API Express et stockage SQLite.

## Démarrage

Prérequis : **Node.js 22.13 ou ultérieur** et npm. Le module SQLite natif peut afficher un avertissement expérimental selon la version de Node.

```powershell
npm install
npm run dev
```

Ouvrir http://localhost:5173. Vite transmet `/api` au serveur sur le port 3001.

### Production

```powershell
npm run build
npm start
```

Le serveur sert alors le site et l'API sur http://localhost:3001. `PORT` modifie le port API ; en développement, adapter également le proxy Vite si ce port change. `DATA_DIR` permet de choisir le dossier de données (par défaut `data`). Préserver ce dossier entre les déploiements. Une seule instance serveur doit utiliser le fichier SQLite.

```powershell
npm test
npm run build
```

### Docker derrière Nginx Proxy Manager

Le dépôt contient un `Dockerfile` (construction en deux étapes, image finale Node 22 Alpine, utilisateur non root) et un `docker-compose.yml`. NPM tourne dans un autre LXC : le conteneur publie donc le port `3001` de l’hôte Docker et NPM l’atteint par l’adresse IP du LXC.

1. Lancer : `docker compose up -d --build`.
2. Dans NPM, créer un *Proxy Host* : domaine voulu, scheme `http`, forward hostname/IP = **IP du LXC Docker**, port `3001`, « Block Common Exploits » coché, certificat Let’s Encrypt et « Force SSL ».
3. Optionnel (fichier `.env` à côté du compose) : `APP_PORT` pour changer le port publié, `APP_BIND` pour l’écouter sur une seule IP (celle du LXC Docker plutôt que `0.0.0.0`). Le port n’a pas d’authentification : n’autoriser que le LXC de NPM (pare-feu Proxmox/LXC) et ne pas l’exposer sur Internet.

La base SQLite vit dans le volume `toilet-data` : il survit aux mises à jour (`git pull` puis `docker compose up -d --build`). Une seule instance doit tourner. Pour l’anonymat, NPM journalise par défaut les adresses IP : ajouter `access_log off;` dans l’onglet *Advanced* du Proxy Host si besoin.

## Règles

Cliquer sur une cuvette pour consulter et signaler son état. Les boutons + / − agrandissent le plan jusqu'à 300 % ; le plan agrandi peut défiler, notamment sur mobile. Le bloc sud comporte cinq cabines hommes. Dans le bloc nord, la cabine N1 est réservée aux femmes et les quatre autres aux hommes. Les urinoirs et lavabos ne sont pas sélectionnables. Les identifiants techniques restent stables pour préserver les signalements existants ; le plan affiche les repères neutres N1–N5 et S1–S5. Les positions et mentions PMR sont à confirmer sur place. Ce plan simplifié et non à l'échelle **n'est pas un plan d'évacuation**.

| Atmosphère | Durée |
|---|---:|
| Petite brise | 15 minutes |
| Nuage suspect | 30 minutes |
| Zone toxique | 60 minutes |
| Radioactif | 90 minutes |

Une nouvelle alerte conserve le maximum du niveau et de l'échéance actifs : elle ne peut pas réduire une alerte existante. La durée ne s'additionne pas à celle déjà en cours. Les alertes s'atténuent automatiquement au fil du compte à rebours : une alerte radioactive devient toxique à 60 minutes restantes, suspecte à 30 minutes, puis une petite brise à 15 minutes. Les niveaux initiaux toxique (60 min) et suspect (30 min) suivent les mêmes seuils de dégradation.

La propreté est indépendante : **propre, dégradé, dangereux, critique**. Le dernier signalement de propreté remplace le précédent. Signaler « Propre » permet d'indiquer un nettoyage ; cela ne supprime pas une alerte atmosphérique. Sans nouveau signalement, la propreté persiste jusqu'à minuit.

Les couleurs donnent priorité à la propreté critique puis dangereuse, puis à l'atmosphère, puis à une propreté dégradée. Le panneau affiche toujours les deux dimensions. « La voie est libre » signifie air frais **et** propreté normale, pas absence d'occupant : l'application ne suit pas l'occupation.

À **00h00 Europe/Paris**, tous les états sont remis à propre et les alertes supprimées, même si leur durée théorique dépasserait minuit. Le serveur vérifie la date avant chaque lecture/écriture et chaque seconde ; après un arrêt nocturne, le nettoyage est effectué au redémarrage. Les jours de 23 ou 25 heures sont pris en charge. Les clients affichent les expirations chaque seconde et interrogent l'API toutes les dix secondes.

## API

- `GET /api/state` : `{ serverTime, resetsAt, toilets }` (horodatages en millisecondes Unix).
- `POST /api/toilets/:id/reports` : corps JSON `{ "kind": "danger", "level": 1 }` à `4`, ou `{ "kind": "cleanliness", "level": "clean" | "degraded" | "dangerous" | "critical" }`. Renvoie l'état complet.
- `GET /api/push/key` : clé publique VAPID. `POST /api/push/subscriptions` : enregistre un abonnement push du navigateur (`201`, `400` si invalide, `503` si la limite de 2000 appareils est atteinte). `POST /api/push/unsubscribe` : `{ "endpoint" }`, renvoie `204`.
- Réponses d'erreur JSON et statuts `400`, `404`, `413` ou `500`.

## Interface, animations et bruitages

L'interface est un **bulletin météo télévisé** : plateau bleu nuit avec isobares, logo de chaîne et horloge « En direct » à l'heure de Paris, titre en bandeau (« lower third ») qui résume le bulletin du moment. Le plan est une carte météo : chaque cabine est un picto (☀️ quand tout va bien, ☁️, ☣️, ☢️, 💩, 🚨…) avec, en guise de température, les minutes restantes de l'alerte ; des nuages dérivent lentement sur la carte et les alertes sérieuses pulsent. Sous la carte, des prévisions cabine par cabine (blocs nord et sud) permettent aussi de sélectionner un WC. Un bandeau d'alertes défile en bas de l'écran. Le panneau « Prévisions » affiche le verdict (La voie est libre, Avec précaution, À éviter), l'atmosphère avec son compte à rebours, la propreté et les choix de signalement.

Chaque signalement enregistré déclenche une animation sur le WC, un « Flash spécial » avec onomatopée et un bruitage adapté :

| Signalement | Bruitage |
|---|---|
| Propre | Chasse d'eau, glouglous du siphon et petit scintillement |
| Dégradé | Double petit prout |
| Dangereux | Prout mouillé suivi d'une éclaboussure |
| Critique | Glouglous de bouchon, deux coups de ventouse et sirène |
| Petite brise | Prout aigu et discret |
| Nuage suspect | Prout franc |
| Zone toxique | Long prout grave, puis des mouches qui bourdonnent |
| Radioactif | Prout cataclysmique et compteur Geiger qui s'affole |

Sélectionner une cabine fait « toc toc » à la porte, et la cuvette affichée quand rien n'est sélectionné tire la chasse quand on clique dessus. Les sons durent de 0,3 à 3 secondes, varient légèrement à chaque lecture et sont synthétisés localement avec Web Audio (`src/feedback.ts`) : aucun fichier audio ni service externe. Le bouton « Bruitages » de l'en-tête les coupe ou les réactive pour l'onglet courant, sans cookie ni stockage. Un navigateur peut refuser l'audio ; un message l'indique sans empêcher l'enregistrement.

Les effets ne sont joués que pour la personne qui agit, jamais lors des actualisations automatiques ou après une erreur API. Les animations respectent la préférence système de réduction des mouvements.

## Application installable et notifications

Le site est une PWA : manifeste, icônes, service worker (coquille de l’appli en cache, jamais l’API). Bouton **Installer** dans l’en-tête (Android/Chrome/Edge/desktop) ; sur iPhone : Partager → *Sur l’écran d’accueil*.

Le bouton **Alertes** abonne l’appareil : chaque signalement, bon ou mauvais, déclenche une notification « 💨 N1 : Nuage suspect » sur tous les appareils abonnés (toucher la notification ouvre le plan sur la cabine). Le serveur implémente Web Push (RFC 8291 + VAPID) sans dépendance ; les clés VAPID sont créées au premier démarrage et conservées dans la base (volume `toilet-data` : ne pas le supprimer, sinon tout le monde doit se réabonner). Variable optionnelle `VAPID_SUBJECT` (`mailto:vous@exemple.fr`).

- **HTTPS obligatoire** (service worker et push) : certificat Let’s Encrypt dans NPM ; `localhost` fonctionne pour tester.
- **iOS 16.4+** : les notifications ne marchent qu’une fois l’appli ajoutée à l’écran d’accueil.
- Les abonnements ne sont liés à aucun signalement ni identité ; ceux qui expirent sont supprimés automatiquement. Les serveurs de push (Google, Mozilla, Apple, Microsoft) voient les adresses d’abonnement, pas le contenu.
- Dans NPM, ne pas mettre en cache `/sw.js`.

## Anonymat et hébergement

Pas de compte, de nom, de texte libre, de cookie ni d'outil analytique. La base conserve seulement l'état actuel par WC et le jour de la dernière remise à zéro. Le serveur applicatif ne journalise ni requêtes, ni adresses IP, ni auteurs de signalements. Il ne s'agit cependant pas d'une garantie d'anonymat réseau : un hébergeur ou mandataire peut journaliser les connexions. Vérifier leur configuration avant publication.

Pour un usage Internet, ajouter HTTPS et une limitation **globale** des requêtes au niveau du mandataire, sans historique nominatif. Sans authentification, toute personne ayant accès au site peut modifier un état ; privilégier un accès réseau interne pour un usage d'équipe.

Voir [la liste des tâches](todo.md).
