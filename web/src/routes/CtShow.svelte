<script lang="ts">
  import { ctDuration, type CtEpisodes } from '../../../shared/ivysilani.ts'
  import Card from '../components/Card.svelte'
  import Page from '../components/Page.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { playCt } from '../lib/actions.ts'
  import { ctDate } from '../lib/ct.ts'
  import { hubApi } from '../lib/hub.svelte.ts'

  /** A show's episodes, newest first, 24 at a time. */
  let { id, title }: { id: string; title: string } = $props()

  let data = $state<CtEpisodes | null>(null)
  let error = $state('')
  let loading = $state(false)

  function load(offset: number): void {
    loading = true
    hubApi<CtEpisodes>(`/api/ct/shows/${encodeURIComponent(id)}/episodes?offset=${offset}`)
      .then((d) => (data = data && offset ? { ...d, items: [...data.items, ...d.items] } : d), (e: Error) => (error = e.message))
      .finally(() => (loading = false))
  }
  $effect(() => load(0))

  const items = $derived(data?.items ?? [])
</script>

<Page title={data?.show.title || title} subtitle={data?.show.description}>
  {#if error}<p class="message">{error}</p>{/if}
  {#if !data && !error}<Spinner />{/if}
  {#if data && !items.length}<p class="message">Žádné díly teď nejsou k přehrání.</p>{/if}
  <div class="grid grid-wide">
    {#each items as e (e.id)}
      <Card landscape title={e.title} image={e.image} subtitle={[ctDate(e.date), ctDuration(e.duration)].filter(Boolean).join(' · ') || undefined}
        onclick={() => void playCt('vod', e.id, e.showTitle && e.showTitle !== e.title ? `${e.showTitle} · ${e.title}` : e.title)} />
    {/each}
  </div>
  {#if data && items.length < data.total}
    <div class="buttons">
      {#if loading}<Spinner />{:else}<button class="btn" onclick={() => load(items.length)}>Načíst další ({data.total - items.length})</button>{/if}
    </div>
  {/if}
</Page>
