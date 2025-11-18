const BACKEND_SERVICE_URL = (() => {
  const raw =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_BACKEND_SERVICE_URL
      : undefined;
  return (raw && raw.trim()) || 'simulated_local';
})();

export { BACKEND_SERVICE_URL };

export const IS_SIMULATED_BACKEND = BACKEND_SERVICE_URL === 'simulated_local';

export const USE_REMOTE_VECTOR =
  !!BACKEND_SERVICE_URL &&
  BACKEND_SERVICE_URL !== 'simulated_local' &&
  BACKEND_SERVICE_URL !== 'local';

const resolveEnvValue = (key: string, fallback?: string) => {
  const fromImportMeta =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env[key]
      : undefined;
  const fromProcess =
    typeof process !== 'undefined' && process.env ? process.env[key] : undefined;
  return (fromImportMeta ?? fromProcess ?? fallback ?? '').toString();
};

export const ENABLE_DAN_EXPERIMENT = (() => {
  const raw = resolveEnvValue('VITE_ENABLE_DAN', 'false').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
})();

export const DAN_KEY_SALT = resolveEnvValue('VITE_DAN_DERIVATION_SALT', 'dan-dev-salt');

export const DAN_REALTIME_CHANNEL = resolveEnvValue('VITE_DAN_REALTIME_CHANNEL', 'dan_events');

export const SUPABASE_BROWSER_URL = resolveEnvValue('VITE_SUPABASE_URL', resolveEnvValue('SUPABASE_URL', ''));
export const SUPABASE_BROWSER_ANON_KEY = resolveEnvValue('VITE_SUPABASE_ANON_KEY', resolveEnvValue('SUPABASE_ANON_KEY', ''));

if (
  ENABLE_DAN_EXPERIMENT &&
  (!SUPABASE_BROWSER_URL || !SUPABASE_BROWSER_ANON_KEY)
) {
  console.warn(
    '[Config] DAN is enabled but Supabase credentials are missing. ' +
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or SUPABASE_URL/SUPABASE_ANON_KEY) in your environment.'
  );
}
