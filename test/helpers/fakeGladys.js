// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface the device modules rely on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - publishState / publishStates   -> record calls so tests can assert them
//   - publishCameraImage             -> record calls so tests can assert them
//   - publishTransports              -> record calls so tests can assert them
//   - setConnectionStatus            -> record calls so tests can assert them
//   - publishDiscoveredDevices       -> record the last payload
//   - handler registration (onPoll, onScanRequest, onConfigUpdated, onAction,
//     on, handleShutdown), kept in `handlers` so tests can invoke them
//   - getConfig / connect            -> `config` is settable by the test
// This lets us test the pure "wiring" logic (discovery payloads, dispatch)
// without a running Gladys server or a real WebSocket.
// -----------------------------------------------------------------------------

export function createFakeGladys({ config = {} } = {}) {
  const published = [];
  const cameraImages = [];
  const transports = [];
  const connectionStatuses = [];
  const handlers = { actions: {}, events: {} };

  return {
    published,
    cameraImages,
    transports,
    connectionStatuses,
    handlers,
    config,
    discovered: null,

    onPoll(callback) {
      handlers.poll = callback;
    },
    onScanRequest(callback) {
      handlers.scanRequest = callback;
    },
    onConfigUpdated(callback) {
      handlers.configUpdated = callback;
    },
    onAction(key, callback) {
      handlers.actions[key] = callback;
    },
    on(event, callback) {
      handlers.events[event] = callback;
    },
    handleShutdown(cleanup) {
      handlers.shutdown = cleanup;
    },
    async connect() {},
    async getConfig() {
      return this.config;
    },
    async publishDiscoveredDevices(devices) {
      this.discovered = devices;
    },

    externalIds(type, platformId) {
      const device = `${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishState(featureExternalId, state) {
      published.push({ featureExternalId, state });
    },

    async publishStates(states) {
      for (const s of states) {
        published.push({ featureExternalId: s.device_feature_external_id, state: s.state });
      }
    },

    async publishCameraImage(deviceExternalId, image) {
      cameraImages.push({ deviceExternalId, image });
    },

    async publishTransports(entries) {
      transports.push(...entries);
    },

    async setConnectionStatus(connected, message) {
      connectionStatuses.push({ connected, message });
    },
  };
}
