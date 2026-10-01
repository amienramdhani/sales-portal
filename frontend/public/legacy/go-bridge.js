/*
  Reserved migration bridge.
  The google.script.run -> Go REST compatibility shim is embedded in legacy/index.html
  so the production UI can be preserved during parity migration.
  Keep this file present to avoid a 404 and to provide a stable extension point for
  browser-only migration helpers that do not contain business logic.
*/
window.SALES_PORTAL_GO_BRIDGE = Object.freeze({version: '2026-09-30'});
