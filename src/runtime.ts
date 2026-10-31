import { detectPlatform } from './platform'

/** The adapter for the device aTV runs on, chosen once at start. */
export const platform = detectPlatform()

/** Builds a query string without URLSearchParams (missing in Tizen 3's engine). */
export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = []
  for (const k of Object.keys(params)) {
    const v = params[k]
    if (v !== undefined && v !== '') parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}
