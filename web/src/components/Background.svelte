<script lang="ts">
  import { findScene } from '../../../shared/appearance.ts'
  import { backgroundUrl, look } from '../lib/appearance.svelte.ts'
  import { hub, hubApi, hubUrl } from '../lib/hub.svelte.ts'

  /** The photo or scene behind the home screen, with a scrim that keeps text readable. */
  let photo = $state<string | null>(null)
  const immich = $derived(look.appearance.background === 'immich' && !!hub.config?.features.photos)

  // Immich: a new random photo every minute.
  $effect(() => {
    if (!immich) {
      photo = null
      return
    }
    let ids: string[] = []
    let i = 0
    const next = () => {
      if (ids.length) photo = `${hubUrl()}/api/photos/${ids[i++ % ids.length]}`
    }
    hubApi<string[]>('/api/photos/random?count=30').then((list) => {
      ids = list
      next()
    }, () => {})
    const t = setInterval(next, 60_000)
    return () => clearInterval(t)
  })

  const url = $derived(immich ? photo : backgroundUrl(look.appearance.background))
  const tint = $derived(findScene(look.appearance.background)?.tint ?? '#151a28')
</script>

<div class="home-bg" style:background-color={tint}>
  {#key url}
    {#if url}<div class="home-bg-image" style:background-image={`url("${url}")`}></div>{/if}
  {/key}
  <div class="home-scrim scrim-{look.appearance.design}"></div>
</div>
