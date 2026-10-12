# Changelog

## [Unreleased]

### Fixed

- **Local polling mode now refreshes your readings on its own.** The gateway
  was only read during a discovery or a connection test, so the devices you
  created did not update. The integration now reads the gateway every 30 or
  60 seconds, as set in the polling interval, and refreshes every created
  device. Nothing to do on your side: existing devices are refreshed as they
  are.
