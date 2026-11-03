import { hub } from './hub.svelte.ts'

/** Current weather from Open-Meteo (no key) for the hub's location, Prague without a hub. */
export const weather = $state({ current: null as { temp: number; code: number } | null })

let lastKey = ''

async function load(): Promise<void> {
  const w = hub.config?.weather ?? { lat: 50.0755, lon: 14.4378 }
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,weather_code&timezone=auto`)
    const d = (await res.json()) as { current?: { temperature_2m: number; weather_code: number } }
    if (d.current) weather.current = { temp: d.current.temperature_2m, code: d.current.weather_code }
  } catch {
    // Offline: no weather shown.
  }
}

/** Starts loading; reloads when the hub's location arrives and every 30 minutes. */
export function startWeather(): void {
  $effect.root(() => {
    $effect(() => {
      const w = hub.config?.weather
      const key = w ? `${w.lat},${w.lon}` : ''
      if (key === lastKey && weather.current) return
      lastKey = key
      void load()
    })
  })
  setInterval(load, 30 * 60_000)
}
