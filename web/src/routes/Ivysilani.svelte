<script lang="ts">
  import { CT_CHANNELS, ctDuration, type CtSearch } from '../../../shared/ivysilani.ts'
  import Card from '../components/Card.svelte'
  import Page from '../components/Page.svelte'
  import Row from '../components/Row.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { playCt } from '../lib/actions.ts'
  import { hubApi } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'
  import { ctDate } from '../lib/ct.ts'

  /** iVysílání: live ČT channels and search in the archive. */
  let query = $state('')
  let result = $state<CtSearch | null>(null)
  let error = $state('')
  let busy = $state(false)

  $effect(() => {
    const q = query.trim()
    result = null
    error = ''
    if (q.length < 2) return
    let cancelled = false
    const timer = setTimeout(() => {
      busy = true
      hubApi<CtSearch>(`/api/ct/search?q=${encodeURIComponent(q)}`)
        .then((r) => !cancelled && (result = r), (e: Error) => !cancelled && (error = e.message))
        .finally(() => !cancelled && (busy = false))
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  })
</script>

<Page title="iVysílání" subtitle="Pořady chráněné DRM v aTV přehrát nejde, ostatní ano.">
  <input class="search-field" type="search" bind:value={query} placeholder="Hledat pořad" aria-label="Hledat v iVysílání" />
  {#if busy}<Spinner label="Hledám v iVysílání…" />{/if}
  {#if error}<p class="message">{error}</p>{/if}
  {#if result && !result.shows.length && !result.episodes.length}<p class="message">V iVysílání nic nenalezeno.</p>{/if}
  {#if result?.shows.length}
    <Row title="Pořady">
      {#each result.shows as s (s.id)}<Card landscape title={s.title} image={s.image} onclick={() => nav.push({ name: 'ct-show', id: s.id, title: s.title })} />{/each}
    </Row>
  {/if}
  {#if result?.episodes.length}
    <Row title="Díly">
      {#each result.episodes as e (e.id)}
        {@const title = e.showTitle && e.showTitle !== e.title ? `${e.showTitle} · ${e.title}` : e.title}
        <Card landscape {title} image={e.image} subtitle={[ctDate(e.date), ctDuration(e.duration)].filter(Boolean).join(' · ') || undefined} onclick={() => void playCt('vod', e.id, title)} />
      {/each}
    </Row>
  {/if}
  <Row title="Živě">
    {#each CT_CHANNELS as c (c.id)}<Card landscape title={c.name} fallback={c.name} onclick={() => void playCt('live', c.id, c.name)} />{/each}
  </Row>
</Page>
