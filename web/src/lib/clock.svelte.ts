/** The current time for clocks, updated every ten seconds. */
export const clock = $state({ now: new Date() })
setInterval(() => (clock.now = new Date()), 10_000)

const DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota']
const MONTHS = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince']

/** "Pátek 30. října". */
export function czechDate(d: Date): string {
  const day = DAYS[d.getDay()]
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} ${d.getDate()}. ${MONTHS[d.getMonth()]}`
}
