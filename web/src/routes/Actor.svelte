<script lang="ts">
  import type { Actor, Filmography } from '../../../shared/actors.ts'
  import Card from '../components/Card.svelte'
  import Page from '../components/Page.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { loadFilmography } from '../lib/actors.ts'
  import { nav } from '../lib/router.svelte.ts'

  let { actor }: { actor: Actor } = $props()

  let data = $state<Filmography | null>(null)
  let error = $state('')
  let attempt = $state(0)
  let oldest = $state(false)
  let fullBio = $state(false)

  $effect(() => {
    void attempt
    let cancelled = false
    data = null
    error = ''
    loadFilmography(actor).then((v) => !cancelled && (data = v), (e: Error) => !cancelled && (error = e.message))
    return () => (cancelled = true)
  })

  const person = $derived(data?.actor || actor)
  const movies = $derived(
    data
      ? [...data.movies].sort((a, b) => {
          if (!a.year || !b.year) return a.year ? -1 : b.year ? 1 : a.title.localeCompare(b.title, 'cs')
          return (oldest ? a.year - b.year : b.year - a.year) || a.title.localeCompare(b.title, 'cs')
        })
      : [],
  )
  const bio = $derived(data?.biography ?? '')
</script>

<Page title={person.name} subtitle={actor.source === 'tmdb' ? 'Filmové role · TMDB' : 'Filmy dostupné ve vaší knihovně Jellyfin'}>
  <div class="intro">
    {#if person.photo}<img class="intro-photo" src={person.photo} alt={person.name} />{/if}
    {#if bio}
      <div>
        <p class="biography">{!fullBio && bio.length > 500 ? `${bio.slice(0, 500)}…` : bio}</p>
        {#if bio.length > 500}<button class="btn ghost" onclick={() => (fullBio = !fullBio)}>{fullBio ? 'Zkrátit životopis' : 'Celý životopis'}</button>{/if}
      </div>
    {/if}
  </div>
  {#if error}
    <p class="message">{error}</p>
    <button class="btn" onclick={() => attempt++}>Zkusit znovu</button>
  {/if}
  {#if !data && !error}<Spinner label="Načítám filmografii…" />{/if}
  {#if data}
    <h2 class="section">Filmografie ({movies.length})</h2>
    <div class="buttons"><button class="btn" onclick={() => (oldest = !oldest)}>{oldest ? 'Řazení: od nejstarších' : 'Řazení: od nejnovějších'}</button></div>
    {#if actor.source === 'tmdb'}<p class="muted">Vyberte film a vyhledejte dostupné verze v aTV.</p>{/if}
    {#if !movies.length}<p class="message">Pro tohoto herce nejsou dostupné žádné filmy.</p>{/if}
    <div class="grid">
      {#each movies as m (m.id)}
        <Card title={m.title} image={m.poster} fallback={m.title} subtitle={[m.year || 'Rok neuveden', m.role].filter(Boolean).join(' · ')}
          onclick={() => nav.push(m.source === 'jellyfin' ? { name: 'detail', itemId: m.id } : { name: 'search', query: `${m.originalTitle}${m.year ? ` ${m.year}` : ''}` })} />
      {/each}
    </div>
  {/if}
</Page>
