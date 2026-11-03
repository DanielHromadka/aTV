<script lang="ts">
  import type { Discography } from '../../../shared/musicians.ts'
  import Card from '../components/Card.svelte'
  import Icon from '../components/Icon.svelte'
  import Page from '../components/Page.svelte'
  import Row from '../components/Row.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { hubApi } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'

  let { id }: { id: string } = $props()

  let data = $state<Discography | null>(null)
  let error = $state('')
  let attempt = $state(0)
  let type = $state('all')
  let oldest = $state(false)
  let limit = $state(48)

  $effect(() => {
    void attempt
    let cancelled = false
    data = null
    error = ''
    hubApi<Discography>(`/api/musicians/${id}`).then((d) => !cancelled && (data = d), (e: Error) => !cancelled && (error = e.message))
    return () => (cancelled = true)
  })

  const releases = $derived.by(() => {
    const list = data?.releases.filter((r) => type === 'all' || r.type === type) ?? []
    return oldest ? [...list].reverse() : list
  })
  const FILTERS = [['all', 'Všechna vydání'], ['album', 'Alba'], ['single', 'Singly'], ['ep', 'EP']]
  const search = (title: string) => data && nav.push({ name: 'audio', query: `${data.musician.name} ${title}` })
</script>

<Page title={data?.musician.name ?? 'Muzikant'} subtitle={data ? `${data.releases.length} vydání · alba, singly a EP` : undefined}>
  {#if error}
    <p class="message">{error}</p>
    <button class="btn" onclick={() => attempt++}>Zkusit znovu</button>
  {:else if !data}<Spinner label="Načítám diskografii…" />
  {:else}
    <div class="intro">
      {#if data.musician.photo}<img class="intro-photo" src={data.musician.photo} alt={data.musician.name} />{/if}
      <div>
        <p class="biography">Vyberte album nebo skladbu a vyhledejte dostupnou nahrávku v Audiu.</p>
        <a class="btn ghost" href={data.musician.link} target="_blank" rel="noreferrer">Profil a metadata na Deezeru <Icon name="external" size={16} /></a>
      </div>
    </div>
    {#if data.tracks.length}
      <Row title="Známé skladby">
        {#each data.tracks as t (t.id)}<Card title={t.title} subtitle={t.album} image={t.cover} onclick={() => search(t.title)} />{/each}
      </Row>
    {/if}
    <h2 class="section">Diskografie ({releases.length})</h2>
    <div class="chips">
      {#each FILTERS as [value, label] (value)}
        <button class="chip" class:on={type === value} onclick={() => { type = value; limit = 48 }}>{label}</button>
      {/each}
      <button class="chip" onclick={() => { oldest = !oldest; limit = 48 }}>{oldest ? 'Od nejstarších' : 'Od nejnovějších'}</button>
    </div>
    {#if !releases.length}<p class="message">V této kategorii nejsou dostupná vydání.</p>{/if}
    <div class="grid">
      {#each releases.slice(0, limit) as r (r.id)}
        <Card title={r.title} image={r.cover} subtitle={[r.year, r.type === 'single' ? 'Singl' : r.type === 'ep' ? 'EP' : 'Album'].filter(Boolean).join(' · ')} onclick={() => search(r.title)} />
      {/each}
    </div>
    {#if releases.length > limit}<button class="btn" onclick={() => (limit += 48)}>Další vydání ({releases.length - limit})</button>{/if}
    <p class="muted small">Fotografie, obaly a diskografie: Deezer. Různé edice stejného alba jsou uvedené samostatně.</p>
  {/if}
</Page>
