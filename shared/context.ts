/** Home screen rows; each is hidden when it has nothing to show. */
export type HomeRow = 'apps' | 'resume' | 'nextup' | 'latest' | 'libraries' | 'channels'

export type DayPart = 'morning' | 'day' | 'evening' | 'night'

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 11) return 'morning'
  if (hour >= 11 && hour < 17) return 'day'
  if (hour >= 17 && hour < 23) return 'evening'
  return 'night'
}

export function greeting(hour: number): string {
  return { morning: 'Dobré ráno', day: 'Dobré odpoledne', evening: 'Dobrý večer', night: 'Dobrou noc' }[dayPart(hour)]
}

/**
 * Row order by time of day: in the evening and at night the unfinished episode matters most,
 * during the day the live channels and new arrivals come earlier.
 */
export function homeRows(hour: number): HomeRow[] {
  switch (dayPart(hour)) {
    case 'morning':
      return ['apps', 'channels', 'resume', 'latest', 'libraries']
    case 'day':
      return ['apps', 'resume', 'latest', 'channels', 'libraries']
    case 'evening':
      return ['resume', 'nextup', 'apps', 'latest', 'libraries', 'channels']
    case 'night':
      return ['resume', 'apps', 'nextup', 'libraries', 'latest', 'channels']
  }
}

/** "1:02:03" or "2:03"; Jellyfin ticks are 100 ns. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export const ticksToSeconds = (ticks: number | undefined): number => (ticks ? ticks / 10_000_000 : 0)
export const secondsToTicks = (seconds: number): number => Math.round(seconds * 10_000_000)

/** WMO weather code (Open-Meteo) → short Czech text and a symbol. */
export function weatherText(code: number): { text: string; icon: string } {
  if (code === 0) return { text: 'Jasno', icon: '☀' }
  if (code <= 2) return { text: 'Polojasno', icon: '⛅' }
  if (code === 3) return { text: 'Zataženo', icon: '☁' }
  if (code <= 48) return { text: 'Mlha', icon: '🌫' }
  if (code <= 57) return { text: 'Mrholení', icon: '🌦' }
  if (code <= 67) return { text: 'Déšť', icon: '🌧' }
  if (code <= 77) return { text: 'Sníh', icon: '❄' }
  if (code <= 82) return { text: 'Přeháňky', icon: '🌦' }
  if (code <= 86) return { text: 'Sněhové přeháňky', icon: '🌨' }
  return { text: 'Bouřky', icon: '⛈' }
}
