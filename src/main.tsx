import { render } from 'preact'
import './styles.css'
import { App } from './app'
import { installFocus } from './nav/focus'
import { platform } from './runtime'
import { config, installHistory, weather } from './state'
import { connectHub } from './services/hub'

platform.init()
const root = document.getElementById('app')!
installFocus(root)
installHistory()
render(<App />, root)
connectHub()

/** Weather for the header and the screensaver, from Open-Meteo (no key), every 30 minutes. */
function loadWeather() {
  const w = config.get()?.weather ?? { lat: 50.0755, lon: 14.4378 }
  fetch(`https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,weather_code&timezone=auto`)
    .then((r) => r.json())
    .then((d: { current?: { temperature_2m: number; weather_code: number } }) => {
      if (d.current) weather.set({ temp: d.current.temperature_2m, code: d.current.weather_code })
    })
    .catch(() => {})
}
let lastWeatherKey = ''
config.subscribe(() => {
  const w = config.get()?.weather
  const key = w ? `${w.lat},${w.lon}` : ''
  if (key !== lastWeatherKey) {
    lastWeatherKey = key
    loadWeather()
  }
})
loadWeather()
window.setInterval(loadWeather, 30 * 60_000)
