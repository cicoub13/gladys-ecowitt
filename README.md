# gladys-ecowitt

Intégration externe [Gladys Assistant](https://gladysassistant.com) pour les
stations météo **Ecowitt** (et compatibles Fine Offset : Froggit, Ambient
Weather).

Chaque capteur physique devient un appareil Gladys distinct, avec sa batterie,
son signal et son historique. Tout est local, sans passer par le cloud Ecowitt.

📖 [Documentation utilisateur](docs/fr.md) · [User documentation](docs/en.md)

## Architecture

Gladys n'autorise la publication d'un port sur le réseau local que pour un
**sous-conteneur** ; le conteneur principal, lui, est le seul à détenir le jeton
d'accès à l'API hôte. D'où deux conteneurs, servis par **une seule image** :

```
LAN                     Réseau privé de l'intégration
┌──────────┐  POST     ┌──────────────┐   SSE    ┌──────────────────────┐
│ station  │──────────►│ receiver     │─────────►│ conteneur principal  │──► API hôte Gladys
│ (WS2910) │:<hostPort>│ (même image) │  :8080   │        (SDK)         │
└──────────┘           └──────────────┘          └──────────┬───────────┘
                                                             │ unicast HTTP
                                                             ▼
                                                      passerelle GW2000…
```

Le receiver n'a ni jeton ni accès à l'API hôte : il reçoit, mémorise et diffuse.
Le conteneur principal le joint par son alias DNS sur le réseau privé.

### L'observation pivot

Deux sources alimentent le même modèle d'appareils. Pour ne pas écrire le
mapping deux fois, elles convergent vers un format unique :

```
sources/pushAdapter  ─┐
                      ├─► Observation ─► catalog ─► devices + features ─► publisher
sources/localAdapter ─┘
```

## Organisation du code

| Chemin                   | Rôle                                                  |
| ------------------------ | ----------------------------------------------------- |
| `index.js`               | Aiguillage entre les deux rôles de l'image            |
| `src/integration.js`     | Câblage du SDK : handlers, cycle de vie               |
| `src/receiver/`          | Serveur HTTP entrant et son client SSE                |
| `src/sources/`           | Adaptateurs push, Wunderground et API locale          |
| `src/ecowitt/units.js`   | Conversions d'unités                                  |
| `src/ecowitt/battery.js` | Encodage des batteries (deux conventions)             |
| `src/ecowitt/catalog.js` | Capteurs → catégories et unités Gladys                |
| `src/gladys/`            | Construction des appareils et publication dédupliquée |
| `src/discovery.js`       | Décodage des annonces UDP des passerelles             |
| `src/store.js`           | État persistant dans `/data`                          |

## Développement

```bash
npm ci
npm test              # node --test, sans framework
npm run lint
npm run format:check
```

Lancer le receiver seul, pour rejouer un relevé capturé :

```bash
node index.js --receiver
curl -X POST http://127.0.0.1:8080/data/report \
  -d 'PASSKEY=TEST&tempf=68.0&humidity=60'
curl http://127.0.0.1:8080/health
```

## Deux pièges documentés

- **Les batteries n'ont pas le même encodage selon la source.** Un WH51 renvoie
  une tension en volts dans le protocole push, et un simple drapeau 0/1 dans
  `get_sensors_info`. D'où deux tables dans `src/ecowitt/battery.js`.
- **Le sous-conteneur réutilise l'image de l'intégration**, donc sa référence
  doit être bumpée à chaque release. Le workflow `release.yml` a été complété en
  ce sens, et `test/manifest.test.js` garde les deux références alignées.

## Licence

Apache-2.0
