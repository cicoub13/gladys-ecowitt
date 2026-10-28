# Changelog

## [Unreleased]

## [1.1.3] - 2026-10-28

### Changed

- Maintenance release: dependency and build updates, no functional change.

## [1.1.2] - 2026-10-13

### Changed

- Maintenance release: dependency and build updates, no functional change.

## [1.1.1] - 2026-10-13

### Fixed

- **Local polling mode now refreshes your readings on its own.** The gateway
  was only read during a discovery or a connection test, so the devices you
  created did not update. The integration now reads the gateway every 30 or
  60 seconds, as set in the polling interval, and refreshes every created
  device. Nothing to do on your side: existing devices are refreshed as they
  are.
- After creating a device, values that rarely change (battery, signal, yearly
  rain…) now show up with the next reading instead of staying empty until
  they change.
