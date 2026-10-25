# Intégration Ecowitt pour Gladys Assistant

## Présentation

Cette intégration fait remonter les capteurs de votre station météo Ecowitt dans
Gladys : température, humidité, vent, pluie, ensoleillement, UV, pression, mais
aussi les sondes déportées (humidité du sol, PM2.5, CO2, foudre, détection de
fuite). Chaque capteur physique devient un appareil Gladys distinct, avec sa
propre batterie et son historique, utilisable dans vos scènes.

Tout se passe en local : aucune donnée ne transite par le cloud Ecowitt.

## Prérequis

- Gladys 4.86 ou supérieur.
- Une station météo, une console ou une passerelle Ecowitt sur le même réseau
  local que la machine qui héberge Gladys.
- Pour le mode réception : l'application **WS View Plus**, et une station
  capable de joindre la machine qui héberge Gladys sur le réseau local, sur le
  port indiqué dans l'écran de configuration.
- Pour le mode interrogation locale : une passerelle ou une console disposant
  d'une API locale (voir la liste ci-dessous), joignable à son adresse IP depuis
  la machine qui héberge Gladys.

## Configuration

Deux modes sont proposés, selon votre matériel.

### Réception (fonctionne avec presque toutes les stations)

Votre station envoie elle-même ses relevés à Gladys. C'est le mode à utiliser
avec les consoles **WS2910, GW1000, WN1900, WN1910, WS2320, HP2550, HP3500** et,
plus généralement, avec tout modèle sauf le WS6006.

1. Installez l'intégration et attendez que le conteneur de réception démarre.
2. Ouvrez l'écran de configuration : l'adresse complète à recopier y est
   affichée, sous la forme `http://<adresse>:<port>/data/report/`. Si elle
   contient `localhost` ou `127.0.0.1` — c'est le cas si vous consultez Gladys
   depuis la machine qui l'héberge — remplacez cette partie par l'**adresse IP
   locale de cette machine** : votre station doit la joindre sur le réseau, et
   `localhost` ne veut rien dire pour elle.
3. Dans l'application **WS View Plus**, sélectionnez votre station, puis
   **Customized** :
   - _Protocol Type Same As_ : **Ecowitt**
   - _Server IP / Hostname_ : l'adresse IP locale de la machine qui héberge
     Gladys
   - _Path_ : `/data/report/`
   - _Port_ : le port indiqué dans Gladys
   - _Upload Interval_ : `60` secondes
   - Activez **Enable** et enregistrez.
4. Patientez le temps d'un premier envoi, puis cliquez sur **Tester la
   réception** pour confirmer que les relevés arrivent.
5. Rendez-vous dans l'écran **Découverte** : vos capteurs y apparaissent.

> Les capteurs ne sont connus qu'après le premier relevé reçu. Si l'écran
> Découverte est vide, c'est presque toujours que la station n'a encore rien
> envoyé : vérifiez l'adresse, le port et le chemin saisis dans WS View Plus.

Si votre console ne propose que le protocole **Wunderground**, il fonctionne
aussi : indiquez le chemin `/weatherstation/updateweatherstation.php`. Il
transporte moins de mesures (ni multi-canal, ni PM2.5, ni CO2, ni foudre).

### Interrogation locale (passerelles récentes)

Les **GW1100, GW1200, GW2000, GW3000** et les consoles réseau récentes
(**WS3800, WS3820, WS3900, WS3910, WN1700, WN1820, WN1821, WN1920, WN1980,
WS6210**) exposent une API locale. Gladys les interroge directement, sans aucune
configuration sur la station.

1. Renseignez l'**adresse IP de la passerelle** dans la configuration. Le bouton
   **Rechercher les passerelles** peut la trouver pour vous.
2. Ajustez l'intervalle d'interrogation si besoin : 30 ou 60 secondes (60 par défaut).
   L'intégration lit la passerelle à ce rythme et rafraîchit les relevés de
   tous les appareils que vous avez créés.
3. Lancez une découverte.

Ce mode a un avantage : il récupère l'identifiant matériel de chaque capteur, si
bien que remplacer une pile ou changer un capteur de canal ne casse ni vos
scènes ni votre historique.

## Choisir le mode

Par défaut, l'intégration bascule en interrogation locale dès qu'une adresse IP
est renseignée, et reste en réception sinon.

Les deux sources ne produisent pas les mêmes identifiants d'appareils : elles ne
sont donc jamais combinées sur une même station. Si vous changez de mode après
avoir créé vos appareils, ceux-ci apparaîtront en double dans l'écran Découverte
— supprimez les anciens.

## Sécurité

Le port de réception est ouvert sur votre réseau local et accepte, par
construction, tout envoi qui lui parvient. Si plusieurs stations coexistent sur
votre réseau, renseignez le champ **PASSKEY** pour n'accepter que la vôtre. Pour le
trouver, saisissez une valeur quelconque dans ce champ et enregistrez : le
relevé suivant est alors ignoré, et les journaux de l'intégration affichent son
PASSKEY (`Relevé ignoré : PASSKEY inattendu (…)`). Copiez cette valeur dans le
champ et enregistrez à nouveau.

## Dépannage

| Symptôme                                                                                          | Piste                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L'écran Découverte reste vide                                                                     | Aucun relevé reçu : vérifiez l'adresse, le port et le chemin dans WS View Plus, puis cliquez sur « Tester la réception ».                                                                                                                       |
| L'adresse affichée semble fausse                                                                  | Elle reprend celle par laquelle votre navigateur joint Gladys : `localhost` si vous êtes sur la machine elle-même, le nom du tunnel via Gladys Plus ou un reverse proxy. Remplacez-la par l'adresse IP locale de la machine qui héberge Gladys. |
| « Rechercher les passerelles » ne trouve rien                                                     | Normal pour une WS2910 ou un GW1000 : ces modèles n'ont pas d'API locale. Utilisez le mode réception.                                                                                                                                           |
| Une mesure manque                                                                                 | Tous les capteurs ne transmettent pas toutes les mesures. Seules celles réellement reçues deviennent des fonctionnalités.                                                                                                                       |
| Aucune batterie sur un capteur solaire                                                            | Ecowitt publie une tension sans documenter de seuil pour les WS80, WS90, WH40 et WH85 : plutôt qu'un état inventé, rien n'est affiché.                                                                                                          |
| « Passerelle injoignable à … »                                                                    | Mode interrogation locale : vérifiez que la passerelle est allumée et que son adresse IP n'a pas changé (attribuez-lui une adresse fixe dans votre box), ou retrouvez-la avec « Rechercher les passerelles ».                                   |
| « Le récepteur des relevés est injoignable (il redémarre peut-être) : nouvel essai automatique. » | Mode réception : le conteneur de réception est peut-être en train de redémarrer. L'intégration réessaie d'elle-même ; si le message persiste, redémarrez l'intégration.                                                                         |
| « L'initialisation a échoué, consultez les logs de l'intégration. »                               | Consultez les logs de l'intégration, puis redémarrez-la.                                                                                                                                                                                        |

Les logs de l'intégration se trouvent dans l'onglet **Logs** de la page de
l'intégration dans Gladys.
