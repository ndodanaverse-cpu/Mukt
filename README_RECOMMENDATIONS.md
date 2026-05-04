Enabling server-side Firestore recommendations

This project includes a lightweight recommendations endpoint at `/api/recommendations`.

By default the server falls back to a static sample catalogue. To enable real product-based recommendations you must provide Firebase Admin credentials so the server can query Firestore.

Two options:

1) Local file (recommended for development)
- Place your service account JSON (downloaded from Google Cloud Console) at the project root, e.g. `serviceAccountKey.json`.
- Copy `.env.example` to `.env` and set:

  FIRESTORE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json

2) Environment variable (recommended for CI / production)
- Set `FIRESTORE_SERVICE_ACCOUNT` to the full JSON string of the service account.

Notes
- The server reads `.env` automatically (dotenv). Restart the Node process after adding credentials.

Caching
 - The server implements a small in-memory TTL cache for recommendation responses (default TTL 60s).
 - To use Redis as a shared cache, set `REDIS_URL` in your `.env` (e.g. `redis://:password@host:6379`). When configured, the server will read/write recommendation responses to Redis with the same TTL.
 - You can adjust TTL with `RECOMMEND_CACHE_TTL_SECONDS` in `.env`.

Install and run

```bash
npm install
npm start
```

Security
- Do NOT commit your service account JSON to source control.
- Use secrets management (CI/CD secret store) for production.

If you'd like, I can also:
- Add an endpoint to surface product popularity signals used for recommendations.
- Implement caching (in-memory or Redis) for recommendation responses.
