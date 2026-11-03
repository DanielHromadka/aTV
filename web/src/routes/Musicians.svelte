<script lang="ts">
  import type { MusicianPage } from '../../../shared/musicians.ts'
  import Card from '../components/Card.svelte'
  import Page from '../components/Page.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { hubApi } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'

  let input = $state('')
  let query = $state('')
  let page = $state(1)
  let attempt = $state(0)
  let data = $state<MusicianPage | null>(null)
  let error = $state('')

  $effect(() => {
    const [q, p] = [query, page]
    void attempt
    let cancelled = false
    data = null
    error = ''
    hubApi<MusicianPage>(`/api/musicians?q=${encodeURIComponent(q)}&page=${p}`).then((d) => !cancelled && (data = d), (e: Error) => !cancelled && (error = e.message))
    return () => (cancelled = true)
  })

  const search = (e: SubmitEvent) => {
    e.preventDefault()
    page = 1
    query = input.trim()
  }
</script>

<Page title="Muzikanti" subtitle="300 známých interpretů a kapel · světová, česká a slovenská hudba">
  <form class="search-form" onsubmit={search}>
    <input class="search-field" type="search" bind:value={input} placeholder="Jméno interpreta nebo kapely" aria-label="Jméno interpreta nebo kapely" />
    <button class="btn primary" type="submit">Hledat</button>
    {#if query}<button class="btn" type="button" onclick={() => { input = ''; query = ''; page = 1 }}>Zobrazit všechny</button>{/if}
  </form>
  {#if error}
    <p class="message">{error}</p>
    <button class="btn" onclick={() => attempt++}>Zkusit znovu</button>
  {/if}
  {#if !data && !error}<Spinner label="Načítám muzikanty…" />{/if}
  {#if data}
    <p class="muted">{data.total} interpretů · strana {data.page} · kurátorský výběr, nikoli žebříček popularity</p>
    {#if !data.musicians.length}<p class="message">Pro toto jméno není ve výběru žádný interpret.</p>{/if}
    <div class="grid">
      {#each data.musicians as m (m.id)}
        <Card title={m.name} image={m.photo} fallback={m.name} onclick={() => nav.push({ name: 'musician', id: m.id })} />
      {/each}
    </div>
    <div class="buttons pager">
      {#if data.page > 1}<button class="btn" onclick={() => { page--; scrollTo(0, 0) }}>Předchozí strana</button>{/if}
      {#if data.more}<button class="btn" onclick={() => { page++; scrollTo(0, 0) }}>Další strana</button>{/if}
    </div>
    <p class="muted small">Fotografie a diskografie: Deezer. Dostupnost vydání se může lišit podle katalogu.</p>
  {/if}
</Page>
