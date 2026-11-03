<script lang="ts">
  import type { ActorPage } from '../../../shared/actors.ts'
  import Card from '../components/Card.svelte'
  import Page from '../components/Page.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { loadActors } from '../lib/actors.ts'
  import { hub } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'
  import { settings } from '../lib/settings.svelte.ts'

  let input = $state('')
  let query = $state('')
  let page = $state(1)
  let attempt = $state(0)
  let data = $state<ActorPage | null>(null)
  let error = $state('')

  $effect(() => {
    const [q, p] = [query, page]
    void attempt
    void hub.config?.features.actors
    void settings.jellyfin
    let cancelled = false
    data = null
    error = ''
    loadActors(q, p).then((v) => !cancelled && (data = v), (e: Error) => !cancelled && (error = e.message))
    return () => (cancelled = true)
  })

  const search = (e: SubmitEvent) => {
    e.preventDefault()
    page = 1
    query = input.trim()
  }
</script>

<Page title="Herci" subtitle="Vyberte herce a prohlédněte si filmy, ve kterých hrál.">
  <form class="search-form" onsubmit={search}>
    <input class="search-field" type="search" bind:value={input} placeholder="Jméno herce" aria-label="Jméno herce" />
    <button class="btn primary" type="submit">Hledat</button>
    {#if query}<button class="btn" type="button" onclick={() => { input = ''; query = ''; page = 1 }}>Zobrazit všechny</button>{/if}
  </form>
  {#if error}
    <p class="message">{error}</p>
    <div class="buttons">
      <button class="btn" onclick={() => attempt++}>Zkusit znovu</button>
      {#if !settings.jellyfin && !hub.config?.features.actors}<button class="btn" onclick={() => nav.push({ name: 'login' })}>Připojit Jellyfin</button>{/if}
    </div>
  {/if}
  {#if !data && !error}<Spinner label="Načítám herce…" />{/if}
  {#if data}
    <p class="muted">
      {data.collection ? `${data.collection.title} · aktivní ${data.collection.fromYear}–${data.collection.toYear}` : data.source === 'tmdb' ? 'Filmová databáze TMDB' : 'Herci z vaší knihovny Jellyfin'} · strana {data.page}
    </p>
    {#if !data.actors.length}<p class="message">{query ? 'Pro toto jméno nebyli nalezeni žádní herci.' : 'Na této stránce nejsou žádní herci.'}</p>{/if}
    <div class="grid">
      {#each data.actors as a (a.id)}
        <Card title={a.name} image={a.photo} fallback={a.name} subtitle={a.knownFor} onclick={() => nav.push({ name: 'actor', actor: a })} />
      {/each}
    </div>
    <div class="buttons pager">
      {#if page > 1}<button class="btn" onclick={() => { page--; scrollTo(0, 0) }}>Předchozí strana</button>{/if}
      {#if data.more}<button class="btn" onclick={() => { page++; scrollTo(0, 0) }}>Další strana</button>{/if}
    </div>
  {/if}
</Page>
