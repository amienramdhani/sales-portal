# Golden comparison

The migration gate compares Apps Script JSON with Go JSON after representation-only normalization.

Rules:
- `null` and missing fields are equivalent.
- Numeric `5` and `5.0` are equivalent because JSON numbers have no integer/float type distinction.
- String `"5"` is NOT equivalent to numeric `5`.
- Dates normalize to `YYYY-MM-DD`.
- Unordered collections may be sorted only on explicitly configured paths.
- Ranking, sorted results and time-series arrays remain order-sensitive.
- Processing timestamps, snapshot IDs, tokens, request IDs and durations are excluded.
- Business rounding is performed by application code, never by the normalizer.

Run:

```bash
node normalize.mjs apps-script.json go.json
```
