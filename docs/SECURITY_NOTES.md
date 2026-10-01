# Security notes

- Never commit `deploy/.env`, service-account JSON, production database exports, PEPPER, PINs or session tokens.
- `_Auth.PIN_HASH` is imported only to PostgreSQL auth storage. Legacy `PIN AKSES` columns are ignored.
- Keep `AUTH_PEPPER` identical to the Apps Script Script Property during parallel operation.
- Service account permission: Viewer/read-only to the finished sync folder only.
- Session cookie: HttpOnly + Secure in production + SameSite=Lax.
- API business data uses `Cache-Control: no-store`.
- Authorization is enforced before data queries; the browser is not a security boundary.
- Demo sessions cannot write.
- Rotate the service-account key and database password after any suspected exposure.
