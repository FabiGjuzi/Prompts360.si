// config.js — the few settings the other modules read, taken from environment variables.
// Outside production every secret has a fixed development fallback so the tests run with no setup.
// In production a missing or development-grade secret aborts startup (fail closed).
const env = process.env;
const isProd = env.NODE_ENV === 'production';

/** Read a required environment variable. In production a missing value aborts startup; elsewhere `fallbackForDev` is used. */
function req(name, fallbackForDev) {
  const v = env[name];
  if (v && v.trim()) return v.trim();
  if (!isProd && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name}`);
}

/** Read an integer environment variable, falling back to `def` when unset or not a number. */
function int(name, def) {
  const v = parseInt(env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
}

// Fixed key used ONLY outside production. Production refuses to start with it.
const DEV_KEY = Buffer.alloc(32, 0x42).toString('base64');

export const config = Object.freeze({
  isProd,

  // Key-value store: a redis:// or rediss:// URL, or the word "memory" for the in-process store.
  valkeyUrl: req('VALKEY_URL', 'memory'),
  // Optional CA certificate (PEM text or file path) for a rediss:// server whose certificate isn't publicly trusted.
  valkeyCa: env.VALKEY_CA_CERT || '',

  // Secrets: APP_SECRET derives the HMAC and pepper sub-keys (HKDF); DATA_KEY is the AES-256-GCM key.
  appSecret: req('APP_SECRET', DEV_KEY),
  dataKey: req('DATA_KEY', DEV_KEY),
  // Previous DATA_KEY, kept during key rotation so older ciphertexts can still be read.
  dataKeyOld: env.DATA_KEY_OLD || '',

  // Session cookie: Secure (and the __Host- name prefix) in production, or when COOKIE_SECURE=1.
  cookieSecure: isProd || env.COOKIE_SECURE === '1',
  sessionIdleSec: int('SESSION_IDLE_SEC', 2 * 3600),
  sessionMaxSec: int('SESSION_MAX_SEC', 24 * 3600),

  // Argon2id cost (RFC 9106 second recommended profile: 64 MiB, 3 passes, 1 lane) and the cap on parallel hashes.
  argon: { memoryCost: int('ARGON_MEMORY_KIB', 65536), timeCost: int('ARGON_TIME', 3), parallelism: 1 },
  argonConcurrency: int('ARGON_CONCURRENCY', 4),
});

if (isProd) {
  for (const k of ['appSecret', 'dataKey']) {
    if (config[k].length < 32) throw new Error(`${k} must be at least 32 random characters`);
    if (config[k] === DEV_KEY) throw new Error(`${k} is the development key`);
  }
}
