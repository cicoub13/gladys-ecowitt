// Payload représentatif du protocole push « Custom Server » d'Ecowitt, tel
// qu'une WS2910 accompagnée de capteurs additionnels l'envoie. Les unités sont
// impériales, comme toujours dans ce protocole.
export const WS2910_PAYLOAD = {
  PASSKEY: '6C1B1E4F0A2D3C4B5A69788796A5B4C3',
  stationtype: 'EasyWeatherPro_V5.1.1',
  runtime: '253400',
  dateutc: '2026-08-15 09:12:33',
  // Console (capteur intérieur intégré)
  tempinf: '75.2',
  humidityin: '45',
  baromrelin: '29.92',
  baromabsin: '29.50',
  wh25batt: '0',
  // Station extérieure 7-en-1
  tempf: '68.0',
  humidity: '60',
  winddir: '180',
  windspeedmph: '10.0',
  windgustmph: '15.0',
  maxdailygust: '21.0',
  solarradiation: '500.00',
  uv: '4',
  wh65batt: '0',
  // Pluviomètre à auget
  rainratein: '0.020',
  eventrainin: '0.040',
  hourlyrainin: '0.020',
  dailyrainin: '0.100',
  weeklyrainin: '0.500',
  monthlyrainin: '2.000',
  yearlyrainin: '20.000',
  // WH31 sur deux canaux
  temp1f: '70.0',
  humidity1: '55',
  batt1: '0',
  temp2f: '64.4',
  humidity2: '62',
  batt2: '1',
  // WH51 humidité du sol
  soilmoisture1: '45',
  soilbatt1: '1.5',
  // WH41 qualité de l'air
  pm25_ch1: '10.0',
  pm25_avg_24h_ch1: '12.5',
  pm25batt1: '5',
  // WH57 foudre
  lightning_num: '3',
  lightning: '12',
  lightning_time: '1755248000',
  wh57batt: '4',
  // WH55 détection de fuite
  leak_ch1: '0',
  leakbatt1: '5',
  freq: '868M',
  model: 'WS2910_V2.2.4',
};
