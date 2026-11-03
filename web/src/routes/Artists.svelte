<script lang="ts">
  import Card from '../components/Card.svelte'
  import Page from '../components/Page.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { hubApi, hubUrl } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'

  type ArtistSummary = { id: string; name: string; count: number; cover: string; photo?: string }

  let artists = $state<ArtistSummary[] | null>(null)
  let error = $state('')
  let query = $state('')
  let page = $state(1)

  $effect(() => {
    hubApi<{ artists: ArtistSummary[] }>('/api/art/artists').then((d) => (artists = d.artists), () => (error = 'Galerii se nepodařilo načíst. Zkuste to znovu.'))
  })

  const filtered = $derived(artists?.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase())) ?? [])
  const image = (id: string) => `${hubUrl()}/api/art/images/${id}?thumb=1`
</script>

<Page title="Umělci" subtitle="Obrazy pro vaši televizi · Wikimedia Commons">
  <input class="search-field" type="search" bind:value={query} oninput={() => (page = 1)} placeholder="Hledat umělce" aria-label="Hledat umělce" />
  {#if error}<p class="message">{error}</p>{/if}
  {#if !artists && !error}<Spinner />{/if}
  {#if artists && !artists.length}<p class="message">Galerie zatím nemá importovaná díla.</p>{/if}
  <div class="grid">
    {#each filtered.slice((page - 1) * 20, page * 20) as a (a.id)}
      <Card title={a.name} subtitle="{a.count} děl" image={image(a.photo ?? a.cover)} onclick={() => nav.push({ name: 'art-artist', id: a.id })} />
    {/each}
  </div>
  <div class="buttons pager">
    {#if page > 1}<button class="btn" onclick={() => { page--; scrollTo(0, 0) }}>Předchozí strana</button>{/if}
    {#if page * 20 < filtered.length}<button class="btn" onclick={() => { page++; scrollTo(0, 0) }}>Další strana</button>{/if}
  </div>
  <p class="muted">{filtered.length} umělců · strana {page}</p>
  <p class="muted small">Volně dostupné reprodukce z Wikimedia Commons. Portréty: Wikipedia / Wikimedia Commons.</p>
</Page>
