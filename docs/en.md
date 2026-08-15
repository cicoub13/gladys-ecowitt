# Ecowitt integration for Gladys Assistant

This integration brings your Ecowitt weather station sensors into Gladys:
temperature, humidity, wind, rain, solar radiation, UV, pressure, and also the
remote probes (soil moisture, PM2.5, CO2, lightning, leak detection). Every
physical sensor becomes its own Gladys device, with its own battery and history,
ready to use in your scenes.

Everything stays local: no data goes through the Ecowitt cloud.

## Two modes, depending on your hardware

### Push (works with almost every station)

Your station sends its readings to Gladys itself. This is the mode to use with
the **WS2910, GW1000, WN1900, WN1910, WS2320, HP2550, HP3500** consoles and,
more generally, with every model except the WS6006.

1. Install the integration and wait for the receiver container to start.
2. Open the configuration screen: the address and port to copy are shown there.
3. In the **WS View Plus** app, select your station, then **Customized**:
   - _Protocol Type Same As_: **Ecowitt**
   - _Server IP / Hostname_: the address shown in Gladys
   - _Path_: `/data/report/`
   - _Port_: the port shown in Gladys
   - _Upload Interval_: `60` seconds
   - Turn **Enable** on and save.
4. Wait for a first upload, then click **Test the connection** to confirm the
   readings are arriving.
5. Go to the **Discover** screen: your sensors are listed there.

> Sensors are only known after the first reading arrives. An empty Discover
> screen almost always means the station has not sent anything yet: double-check
> the address, port and path set in WS View Plus.

If your console only offers the **Wunderground** protocol, that works too: use
the path `/weatherstation/updateweatherstation.php`. It carries fewer
measurements (no multi-channel, no PM2.5, no CO2, no lightning).

### Local polling (recent gateways)

The **GW1100, GW1200, GW2000, GW3000** and the recent network consoles
(**WS3800, WS3820, WS3900, WS3910, WN1700, WN1820, WN1821, WN1920, WN1980,
WS6210**) expose a local API. Gladys polls them directly, with nothing to
configure on the station.

1. Fill in the **gateway IP address** in the configuration. The **Search for
   gateways** button can find it for you.
2. Adjust the polling interval if needed (60 seconds by default).
3. Run a discovery.

This mode has one advantage: it reads each sensor's hardware id, so replacing a
battery or moving a sensor to another channel breaks neither your scenes nor
your history.

## Choosing the mode

By default the integration switches to local polling as soon as an IP address is
set, and stays in push mode otherwise.

The two sources do not produce the same device identifiers, so they are never
combined on a single station. If you switch modes after creating your devices,
they will show up again in the Discover screen — delete the old ones.

## Security

The receiving port is open on your local network and accepts, by design, any
upload that reaches it. If several stations coexist on your network, fill in the
**PASSKEY** field to accept only yours. You will find it in the integration logs
on the first reading received.

## Troubleshooting

| Symptom                             | What to check                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Discover screen stays empty     | No reading received: check the address, port and path in WS View Plus, then click "Test the connection".                                                                    |
| The displayed address looks wrong   | If you browse Gladys through Gladys Plus or a reverse proxy, the address shown is the tunnel's. Use the local address of Gladys: the station must reach it on your network. |
| "Search for gateways" finds nothing | Expected on a WS2910 or a GW1000: those models have no local API. Use the push mode.                                                                                        |
| A measurement is missing            | Not every sensor reports every measurement. Only the ones actually received become features.                                                                                |
| No battery on a solar sensor        | Ecowitt reports a voltage but documents no threshold for the WS80, WS90, WH40 and WH85: rather than an invented state, nothing is shown.                                    |
