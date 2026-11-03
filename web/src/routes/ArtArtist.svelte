<script lang="ts">
  import type { ArtArtist } from '../../../shared/art.ts'
  import Card from '../components/Card.svelte'
  import Icon from '../components/Icon.svelte'
  import Page from '../components/Page.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { hubApi, hubUrl } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'

  let { id }: { id: string } = $props()

  let data = $state<ArtArtist | null>(null)
  let error = $state('')

  $effect(() => {
    hubApi<ArtArtist>(`/api/art/artists/${id}`).then((d) => (data = d), () => (error = 'Díla nelze načíst. Zkuste to znovu.'))
  })

  const image = (work: string, thumb = false) => `${hubUrl()}/api/art/images/${work}${thumb ? '?thumb=1' : ''}`
</script>

<Page title={data?.name ?? 'Umělec'} subtitle={data ? `${data.works.length} děl · vyberte obraz nebo spusťte galerii` : undefined}>
  {#if error}<p class="message">{error}</p>{/if}
  {#if !data && !error}<Spinner />{/if}
  {#if data}
    <div class="intro">
      {#if data.photo}<img class="intro-photo" src={image(`portrait-${data.id}`)} alt={data.name} />{/if}
      <button class="btn primary" onclick={() => nav.push({ name: 'gallery', artistId: id, start: 0 })}><Icon name="start" size={18} /> Spustit galerii</button>
    </div>
    <div class="grid">
      {#each data.works as w, i (w.id)}
        <Card title={w.title} subtitle={w.date} image={image(w.id, true)} onclick={() => nav.push({ name: 'gallery', artistId: id, start: i })} />
      {/each}
    </div>
  {/if}
</Page>
