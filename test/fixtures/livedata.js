// Réponses de l'API HTTP locale d'une passerelle récente (GW2000), telles que
// documentées par Ecowitt. Deux particularités reproduites ici :
//   - les unités voyagent DANS la valeur (« 0.00 mph ») ou dans un champ
//     `unit` voisin, et suivent les réglages de l'utilisateur ;
//   - un capteur non appairé porte l'identifiant FFFFFFFF et la batterie « 9 ».

export const LIVEDATA_IMPERIAL = {
  common_list: [
    { id: '0x02', val: '68.0', unit: 'F' },
    { id: '0x07', val: '60%' },
    { id: '0x03', val: '53.6', unit: 'F' },
    { id: '0x0A', val: '180' },
    { id: '0x0B', val: '10.00 mph' },
    { id: '0x0C', val: '15.00 mph' },
    { id: '0x19', val: '21.00 mph' },
    { id: '0x15', val: '500.00 w/m2' },
    { id: '0x17', val: '4' },
    { id: '3', val: '68.0', unit: 'F' },
  ],
  rain: [
    { id: '0x0D', val: '0.04 in' },
    { id: '0x0E', val: '0.02 in/Hr' },
    { id: '0x10', val: '0.10 in' },
    { id: '0x11', val: '0.50 in' },
    { id: '0x12', val: '2.00 in' },
    { id: '0x13', val: '20.00 in' },
  ],
  wh25: [{ intemp: '75.2', unit: 'F', inhumi: '45%', abs: '29.50 inHg', rel: '29.92 inHg' }],
  lightning: [{ distance: '12 km', timestamp: '08/15/2026 09:12:33', count: '3', battery: '4' }],
  ch_aisle: [
    { channel: '1', name: '', battery: '0', temp: '70.0', unit: 'F', humidity: '55%' },
    { channel: '2', name: '', battery: '1', temp: '64.4', unit: 'F', humidity: 'None' },
  ],
  ch_soil: [{ channel: '1', name: '', battery: '0', humidity: '45%' }],
  ch_leak: [{ channel: '1', name: '', battery: '5', status: 'Normal' }],
};

export const SENSORS_INFO = {
  sensor: [
    {
      img: 'wh65',
      type: '0',
      name: 'Temp & Humidity & Solar & Wind & Rain',
      id: 'CC44',
      batt: '0',
      signal: '4',
    },
    { img: 'wh57', type: '26', name: 'Lightning', id: 'C497', batt: '4', signal: '3' },
    { img: 'wh31', type: '19', name: 'Temp & Humidity CH1', id: 'A1B2', batt: '0', signal: '4' },
    { img: 'wh31', type: '20', name: 'Temp & Humidity CH2', id: 'A1B3', batt: '1', signal: '2' },
    { img: 'wh51', type: '31', name: 'Soil moisture CH1', id: 'D8174', batt: '0', signal: '4' },
    // Capteur non appairé : doit être ignoré partout.
    { img: 'wh41', type: '22', name: 'PM2.5 CH1', id: 'FFFFFFFF', batt: '9', signal: '0' },
  ],
};
