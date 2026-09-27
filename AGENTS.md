# AGENTS.md — gladys-ecowitt

Project-specific notes. Generic rules (SDK contract, commands, kit-owned files, runtime) live in
`CLAUDE.md`; the two-container diagram and code map live in `README.md`. Code comments and test
names are in French.

## Two roles, one image

- `index.js` picks the role: `--receiver` (or `ECOWITT_ROLE=receiver`) starts `src/receiver/server.js`,
  otherwise `src/integration.js` (SDK). The manifest `containers[0]` runs the same image with
  `["node","index.js","--receiver"]`; `test/manifest.test.js` asserts image, command and version stay aligned.
- Receiver, 2 HTTP servers, no SDK token:
  - published port 8080 (`ECOWITT_RECEIVER_PORT`, manifest port name `ecowitt`): accepts **any POST
    path** (Ecowitt form-urlencoded, answers `OK\n`) on purpose, since users type the path in WS View Plus.
    `GET /weatherstation/updateweatherstation.php` = Wunderground; must answer exactly `success\n`;
    `PASSWORD` is deleted before storing. Body cap 64 KB (413); unparsable URL returns 400 (used to crash).
  - internal port 8081 (`ECOWITT_RECEIVER_INTERNAL_PORT`, never published): `GET /events` (SSE, replays
    the last reading on connect, `: keep-alive` every 25 s) and `GET /health` or `/last`
    (`{receivedCount, subscribers, last}`). Never serve these on the published port (tested).
- `src/receiver/client.js` (main container) reaches `http://receiver:8081` (`ECOWITT_RECEIVER_URL`)
  through the sub-container DNS alias. It reconnects with backoff from 1 s to 30 s, a 60 s idle
  watchdog and a 5 s timeout on `status()`.

## Data flow

- Push: receiver SSE → `integration.handleReading` → (`sources/wunderground.toEcowittPayload` if
  `protocol === 'wunderground'`) → `station_passkey` filter → `sources/pushAdapter.toObservation`.
- Local polling: `onPoll`/`onScanRequest` → `sources/localAdapter.createLocalClient().getObservation()`
  (`/get_livedata_info` + `/get_sensors_info`, no auth, 8 s timeout, 10 s cache + in-flight dedup
  because Gladys fires `onPoll` **per device**). A failing `get_sensors_info` is tolerated (missing on some firmwares).
- Both produce the pivot **Observation** `{stationId, model, receivedAt, sensors:[{type, channel,
hardwareId, values, battery, signal}]}` → `ingest()`: `store.merge` → republish discovered devices if
  the profile changed → `gladys/publisher.publish(buildStates(...))`.
- `gladys/publisher.js` dedups by last published value (mandatory: 40–60 features, pushes as often
  as every 16 s, 300 states/min limit) and only records values after a successful batch. `reset()` on each `connected`.
- Modes (`src/config.js`): `auto` resolves to `local` if `gateway_ip` is set, else `push`. The mode is
  **exclusive**: push readings are dropped in local mode, because the two sources give different ids and would duplicate devices.
- Connection status (`reportSource` in `integration.js`) follows the active source: gateway
  unreachable (local) or receiver SSE down (push). It is only re-sent on change, or forced on reconnect.

## external_id (must stay stable)

- `gladys.externalIds(sensor.type, platformId)` → `ext:<integration>:<type>:<platformId>[:<featureKey>]`.
- `platformId` (`src/gladys/buildDevices.js`): local mode with a hardware id gives `<type>-<HARDWAREID>`
  (uppercase, survives channel changes). Otherwise it is `<stationId|'unknown'>-<type>[:<channel>]`
  (`sensorKey` in `src/store.js`).
- `stationId`: push is `PASSKEY`; local is the `id` of the first `wh65|wh90|wh80` entry in `get_sensors_info`.
- Sensor `type` = catalog key: `gateway`, `outdoor`, `rain`, `wh31`(8 ch), `wh34`(8), `wh51`(16),
  `wh35`(8), `wh41`(4), `wh45`, `wh55`(4), `wh57`. Feature keys = catalog `key`s plus `battery`,
  `batteryLow`, `signal`. Renaming a key or type orphans user devices.

## Mapping pitfalls

- `src/ecowitt/catalog.js` is the only mapping reference. Adapters only emit `values` keyed by catalog `key`s;
  unknown types are skipped silently. Device name = French `name.fr` (+ channel).
- Units: push is **always imperial** (fixed conversion via `readPushValue`). Local follows user settings,
  with the unit either inside the string (`"0.00 mph"`) or in a sibling `unit` field, so parse it and never
  assume it (`parseValueWithUnit`). Empty push fields must stay `null`, not `0` (0 °F bug guard).
- Solar radiation W/m² ×126.7 → lux (Gladys `light-sensor` only takes lux). Local signal 0–4 ×25 → %.
- Batteries (`src/ecowitt/battery.js`): the same sensor encodes battery differently per source (WH51 is volts
  in push and a 0/1 flag locally). Push strategies are regexes on the key (first match wins); local strategies
  are keyed by `img`. Raw local voltage ×0.02 V, low battery at ≤1.2 V. Level 0–5 → ×20 % (6 = mains, capped).
  Supercap sensors (wh40/68/80/90/85, ws90cap) have no documented threshold, so no battery feature. `batt`="9" means unpaired.
- Local: unpaired sensors have id `FFFFFFFF`/`FFFFFFFE`. Channel ↔ inventory link is only the `CH<n>`
  suffix of `name`. Piezo rain (`piezoRain`, `*_piezo` push keys) wins over the tipping bucket.
- Wunderground `rainin` = hourly rain (mapped to `hourlyrainin`); no multi-channel, PM, CO2 or lightning.
- `poll_frequency`: Gladys validates it **in ms** against `[1000,2000,10000,15000,30000,60000]` and rejects
  the whole publish otherwise. Config snaps to 30 or 60 s (`nearestPollFrequency`, legacy values up to 3600
  map to 60); it is sent ×1000 and only in local mode. Same fix as gladys-tp-link.
- Gateway discovery (`src/discovery.js`): the UDP broadcast on port 46000 is captured by Gladys core via
  `scanNetwork('udp-broadcast')` and decoded here (`0xFF 0xFF 0x12` frame). Prefer `source_ip` over the announced IP.
  WS2910/GW1000 have no local API and do not announce.

## /data and config

- `/data/state.json` (`GLADYS_ECOWITT_STATE_PATH`): `{stationId, sensors:{<sensorKey>:{type, channel,
hardwareId, featureKeys, batteryKind, hasSignal, lastSeenAt}}}`. It keeps the **union** of features
  ever seen, so discovery survives restarts and features don't flicker (e.g. the daily max gust resets at
  midnight). Writes are debounced 2 s, atomic (tmp + rename), mode 0600; a malformed file resets to empty.
- Config keys: `mode`, `gateway_ip`, `poll_frequency`, `station_passkey`; `intro_*`/`push_endpoint` are
  display-only sections. `DEFAULT_CONFIG` must match manifest defaults (tested).
- Actions: `test_reception`, `scan_gateways` (each needs a handler, tested).

## Process safety

- `src/safety.js`: an unhandled rejection is logged, then exit(1). So every fire-and-forget promise
  (SSE loop, `onStreamStatus`, request handlers via `safely()`) must catch its own errors.
- A refused initial `connect()` is logged and the process stays alive; the SDK keeps retrying.

## Tests

- `test/helpers/fakeGladys.js`: in-memory SDK (`externalIds` without the `ext:` prefix, records publishes and
  statuses, stores handlers in `handlers` so tests can call them).
- Fixtures: `test/fixtures/ws2910.js` (push payload, imperial) and `test/fixtures/livedata.js`
  (`LIVEDATA_IMPERIAL`, `SENSORS_INFO`, with unpaired entries).
- `test/integration.test.js` starts a real receiver on free ports, a fake HTTP gateway you can switch
  on and off, and a store in `tmpdir()`. `createLocalClient({fetchImpl})` and `startIntegration({gladys, store, receiverUrl})` are the injection points.
- Replay locally: `node index.js --receiver` then POST to `:8080/data/report` (see README).
