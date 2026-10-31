/** Flat line icons for the phone remote (24×24, stroked in the current text colour). */
const PATHS: Record<string, string[]> = {
  up: ['M6 15l6-6 6 6'],
  down: ['M6 9l6 6 6-6'],
  left: ['M15 6l-6 6 6 6'],
  right: ['M9 6l6 6-6 6'],
  mic: ['M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
  send: ['M4 12l16-8-6 16-3-7z'],
  back: ['M9 14l-5-5 5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'],
  home: ['M3 11l9-7 9 7', 'M5 10v10h14V10'],
  playpause: ['M4 6l8 6-8 6z', 'M16 6v12', 'M20 6v12'],
  play: ['M7 5l12 7-12 7z'],
  pause: ['M8 5v14', 'M16 5v14'],
  voldown: ['M4 9h4l5-4v14l-5-4H4z', 'M17 10a3 3 0 0 1 0 4'],
  volup: ['M4 9h4l5-4v14l-5-4H4z', 'M16.5 9.5a4 4 0 0 1 0 5', 'M19 7a7.5 7.5 0 0 1 0 10'],
  mute: ['M4 9h4l5-4v14l-5-4H4z', 'M16 10l5 5', 'M21 10l-5 5'],
  power: ['M12 3v9', 'M6.3 6.3a8 8 0 1 0 11.4 0'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  ok: ['M5 12l5 5 9-10'],
  remote: ['M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M12 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z', 'M10 14h.01', 'M14 14h.01', 'M10 17h.01', 'M14 17h.01'],
  globe: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z'],
  palette: ['M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z', 'M7.5 11.5h.01', 'M10 7.5h.01', 'M15 7.5h.01'],
}

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
