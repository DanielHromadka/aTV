<script lang="ts">
  import { weatherText } from '../../../shared/context.ts'
  import { weather } from '../lib/weather.svelte.ts'

  const info = $derived(weather.current ? weatherText(weather.current.code) : null)
</script>

{#if weather.current && info}
  <span class="weather" title={info.text}><span class="weather-icon">{info.icon}</span>{Math.round(weather.current.temp)}°</span>
{/if}
