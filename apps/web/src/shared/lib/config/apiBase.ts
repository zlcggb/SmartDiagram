const configuredApiBase = String(import.meta.env?.VITE_API_BASE_URL ?? '').trim()

/**
 * Keep browser requests same-origin in development so Vite proxies `/api`.
 * A fully-qualified VITE_API_BASE_URL remains available for split deployments.
 */
export const API_BASE = configuredApiBase.replace(/\/+$/, '')
