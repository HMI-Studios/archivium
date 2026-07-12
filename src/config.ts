import dotenv from 'dotenv';
dotenv.config();

function formatEnv(env) {
  env.PORT = Number(env.PORT);
  env.HOCUSPOCUS_PORT = Number(env.HOCUSPOCUS_PORT);
  env.DEV_MODE = env.DEV_MODE === 'true';
  env.WEB_PUSH_ENABLED = env.WEB_PUSH_ENABLED === 'true';
  env.CORS_ALLOWED_DOMAINS = (env.CORS_ALLOWED_DOMAINS ?? env.DOMAIN ?? '')
    .split(',')
    .map((domain: string) => domain.trim())
    .filter(Boolean);
  return env;
}

export const {
  PORT,
  HOCUSPOCUS_PORT,
  PROVIDER_ADDRESS,
  DOMAIN,
  ADDR_PREFIX,
  DEV_MODE,
  SITE_OWNER_EMAIL,
  MAILERSEND_API_KEY,
  OPENAI_API_KEY,
  RECAPTCHA_KEY,
  ARCHIVIUM_DB_HOST,
  ARCHIVIUM_DB_USER,
  ARCHIVIUM_DB_PASSWORD,
  ARCHIVIUM_DB,
  WEB_PUSH_ENABLED,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  CORS_ALLOWED_DOMAINS,
} = formatEnv({ ...process.env });

export const DB_CONFIG = {
  host: ARCHIVIUM_DB_HOST,
  user: ARCHIVIUM_DB_USER,
  password: ARCHIVIUM_DB_PASSWORD,
  database: ARCHIVIUM_DB,
};
