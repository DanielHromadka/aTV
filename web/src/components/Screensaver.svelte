<script lang="ts">
  import { greeting } from '../../../shared/context.ts'
  import { backgroundUrl, look } from '../lib/appearance.svelte.ts'
  import { clock } from '../lib/clock.svelte.ts'
  import { hub, hubApi, hubUrl } from '../lib/hub.svelte.ts'
  import Weather from './Weather.svelte'

  /** Photos from Immich (through the hub) cross-fading every 20 s, else the home background; any input closes it. */
  let { onclose }: { onclose: () => void } = $props()

  let photos = $state<string[]>([])
  let index = $state(0)

  $effect(() => {
    if (!hub.config?.features.photos) return
    hubApi<string[]>('/api/photos/random?count=30').then((list) => (photos = list), () => {})
  })
  $effect(() => {
    const t = setInterval(() => index++, 20_000)
    return () => clearInterval(t)
  })

  const fallback = $derived(backgroundUrl(look.appearance.background))
  const time = $derived(`${clock.now.getHours()}:${String(clock.now.getMinutes()).padStart(2, '0')}`)
</script>

<svelte:window onkeydown={onclose} onpointerdown={onclose} />

<div class="screensaver" role="presentation">
  {#if photos.length}
    {#each photos as id, i (id)}
      {@const current = i === index % photos.length}
      <div class="saver-photo" class:show={current}
        style:background-image={current || i === (index + 1) % photos.length ? `url("${hubUrl()}/api/photos/${id}")` : undefined}></div>
    {/each}
  {:else if fallback}
    <div class="saver-photo show" style:background-image={`url("${fallback}")`}></div>
  {/if}
  <div class="saver-info">
    <div class="saver-time">{time}</div>
    <div class="saver-sub">{greeting(clock.now.getHours())} · <Weather /></div>
  </div>
</div>
