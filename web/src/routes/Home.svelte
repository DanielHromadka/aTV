<script lang="ts">
  import type { Actor } from '../../../shared/actors.ts'
  import { formatTime } from '../../../shared/context.ts'
  import type { Channel } from '../../../shared/m3u.ts'
  import type { Musician, MusicianPage } from '../../../shared/musicians.ts'
  import Background from '../components/Background.svelte'
  import Card from '../components/Card.svelte'
  import Hero from '../components/Hero.svelte'
  import Row from '../components/Row.svelte'
  import { playItem } from '../lib/actions.ts'
  import { loadActors } from '../lib/actors.ts'
  import { hub, hubApi, hubUrl, loadChannels } from '../lib/hub.svelte.ts'
  import { itemTitle, jellyfin, type Item } from '../lib/jellyfin.ts'
  import { nav } from '../lib/router.svelte.ts'
  import { settings } from '../lib/settings.svelte.ts'
  import { visibleTiles } from '../lib/tiles.ts'
  import { watching } from '../lib/watch-history.svelte.ts'

  type ArtistSummary = { id: string; name: string; count: number; cover: string; photo?: string }
  type Source = { id: string; name: string; searchable: boolean; categories: number[] }

  const tiles = $derived(visibleTiles(settings, hub.config))
  const jf = $derived(settings.jellyfin ? jellyfin() : null)

  let resume = $state<Item[]>([])
  let nextup = $state<Item[]>([])
  let latest = $state<Item[]>([])
  let libraries = $state<Item[]>([])
  let channels = $state<Channel[]>([])
  let actors = $state<{ title: string; list: Actor[] }>({ title: 'Herci', list: [] })
  let musicians = $state<Musician[]>([])
  let artists = $state<ArtistSummary[]>([])
  let sources = $state<Source[]>([])
  let sourcesError = $state(false)

  const safe = <T,>(p: Promise<T[]> | undefined): Promise<T[]> => (p ? p.catch(() => [] as T[]) : Promise.resolve([] as T[]))

  $effect(() => {
    const client = jf
    let cancelled = false
    void Promise.all([safe(client?.resume()), safe(client?.nextUp()), safe(client?.latest()), safe(client?.views())]).then(([r, n, l, v]) => {
      if (cancelled) return
      // Next up repeats what is already in "continue watching".
      const ids = new Set(r.map((i) => i.SeriesId ?? i.Id))
      resume = r
      nextup = n.filter((i) => !ids.has(i.SeriesId ?? i.Id))
      latest = l
      libraries = v
    })
    return () => (cancelled = true)
  })

  $effect(() => {
    if (hub.config?.features.iptv) void loadChannels().then((c) => (channels = c), () => {})
  })

  $effect(() => {
    void hub.config?.features.actors
    void settings.jellyfin
    loadActors().then((v) => (actors = { title: v.collection?.title || 'Herci', list: v.actors.slice(0, 12) }), () => (actors = { title: 'Herci', list: [] }))
  })

  $effect(() => {
    void hub.connected
    hubApi<MusicianPage>('/api/musicians').then((d) => (musicians = d.musicians.slice(0, 12)), () => {})
    hubApi<{ artists: ArtistSummary[] }>('/api/art/artists').then((d) => (artists = d.artists.slice(0, 12)), () => {})
    hubApi<{ indexers: Source[] }>('/api/media/providers').then((d) => {
      sources = d.indexers.filter((i) => i.searchable || i.categories.some((c) => c >= 3000 && c < 4000))
      sourcesError = false
    }, () => (sourcesError = !!hub.config))
  })

  const artImage = (id: string) => `${hubUrl()}/api/art/images/${id}?thumb=1`
</script>

<Background />
<main class="home">
  <Hero {tiles} />
  <div class="home-rest">
    {#if watching.entries.length || resume.length}
      <Row title="Pokračovat ve sledování">
        {#each watching.entries as e (e.id)}
          <Card landscape title={e.source.title} image={e.source.poster}
            subtitle="{formatTime(e.position)}{e.duration ? ` z ${formatTime(e.duration)}` : ''} · {e.source.audioOnly ? 'Audio' : e.source.mediaKey ? 'Torrent' : 'Video'}"
            progress={e.duration ? e.position / e.duration : undefined}
            onclick={() => nav.push({ name: 'player', source: { ...e.source, startSeconds: e.position } })} />
        {/each}
        {#each resume as i (i.Id)}
          <Card landscape title={i.SeriesName ?? i.Name} subtitle={i.SeriesName ? itemTitle(i) : i.ProductionYear ? String(i.ProductionYear) : undefined}
            image={jf?.cardImage(i, true, 270)} progress={(i.UserData?.PlayedPercentage ?? 0) / 100} onclick={() => void playItem(i)} />
        {/each}
      </Row>
    {/if}

    {#if actors.list.length}
      <Row title={actors.title} more={{ label: 'Všichni herci', onclick: () => nav.push({ name: 'actors' }) }}>
        {#each actors.list as a (a.id)}
          <Card title={a.name} image={a.photo} fallback={a.name} subtitle={a.knownFor} onclick={() => nav.push({ name: 'actor', actor: a })} />
        {/each}
      </Row>
    {/if}

    {#if musicians.length}
      <Row title="300 známých muzikantů" more={{ label: 'Všichni muzikanti', onclick: () => nav.push({ name: 'musicians' }) }}>
        {#each musicians as m (m.id)}
          <Card title={m.name} image={m.photo} fallback={m.name} onclick={() => nav.push({ name: 'musician', id: m.id })} />
        {/each}
      </Row>
    {/if}

    {#if artists.length}
      <Row title="Umělci · Galerie" more={{ label: 'Všichni umělci', onclick: () => nav.push({ name: 'artists' }) }}>
        {#each artists as a (a.id)}
          <Card title={a.name} subtitle="{a.count} děl" image={artImage(a.photo ?? a.cover)} onclick={() => nav.push({ name: 'art-artist', id: a.id })} />
        {/each}
      </Row>
    {/if}

    <section class="home-section">
      <h2>Jellyfin</h2>
      <div class="buttons">
        <button class="btn" onclick={() => nav.push({ name: jf ? 'library' : 'login' })}>{jf ? 'Otevřít knihovnu Jellyfin' : 'Připojit Jellyfin'}</button>
        {#if jf}<button class="btn ghost" onclick={() => nav.push({ name: 'login' })}>Nastavení připojení</button>{/if}
      </div>
    </section>

    {#if jf && nextup.length}
      <Row title="Další díly">
        {#each nextup as i (i.Id)}
          <Card landscape title={i.SeriesName ?? i.Name} subtitle={itemTitle(i)} image={jf.cardImage(i, true, 270)} onclick={() => void playItem(i)} />
        {/each}
      </Row>
    {/if}
    {#if jf && latest.length}
      <Row title="Nově přidané">
        {#each latest as i (i.Id)}
          <Card title={i.Name} subtitle={i.ProductionYear ? String(i.ProductionYear) : undefined} image={jf.cardImage(i, false, 360)} onclick={() => nav.push({ name: 'detail', itemId: i.Id })} />
        {/each}
      </Row>
    {/if}
    {#if jf && libraries.length}
      <Row title="Knihovny">
        {#each libraries as i (i.Id)}
          <Card landscape title={i.Name} image={jf.cardImage(i, false, 270)} onclick={() => nav.push({ name: 'library', parentId: i.Id, title: i.Name, collectionType: i.CollectionType })} />
        {/each}
      </Row>
    {/if}
    {#if channels.length}
      <Row title="Televize">
        {#each channels.slice(0, 16) as ch (ch.id)}
          <Card landscape title={ch.name} subtitle={ch.group} image={ch.logo} fallback={ch.name}
            onclick={() => nav.push({ name: 'player', source: { kind: 'url', url: ch.url, title: ch.name, live: true } })} />
        {/each}
      </Row>
    {/if}
    {#if sourcesError}
      <p class="muted home-section">Torrentové zdroje se nepodařilo načíst. Zkontrolujte spojení s Jackettem.</p>
    {:else if sources.length}
      <Row title="Torrentové zdroje">
        {#each sources as s (s.id)}
          <Card landscape title={s.name} fallback={s.name} subtitle={s.searchable ? 'Hledat filmy v tomto zdroji' : 'Hledat audio v tomto zdroji'}
            onclick={() => nav.push(s.searchable ? { name: 'source-search', indexer: s.id, label: s.name } : { name: 'audio', indexer: s.id, label: s.name })} />
        {/each}
      </Row>
    {/if}
  </div>
</main>
