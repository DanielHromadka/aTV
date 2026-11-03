<script lang="ts">
  import type { Channel } from '../../../shared/m3u.ts'
  import Card from '../components/Card.svelte'
  import Page from '../components/Page.svelte'
  import Row from '../components/Row.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { loadChannels } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'

  /** Live channels from the hub's M3U playlist, one row per group. */
  let list = $state<Channel[] | null>(null)
  let error = $state('')

  $effect(() => {
    loadChannels().then((l) => (list = l), (e: Error) => (error = e.message))
  })

  const groups = $derived.by(() => {
    const out = new Map<string, Channel[]>()
    for (const ch of list ?? []) {
      const name = ch.group ?? 'Kanály'
      out.set(name, [...(out.get(name) ?? []), ch])
    }
    return out
  })
</script>

<Page title="Televize">
  {#if error}<p class="message">{error}</p>{/if}
  {#if !list && !error}<Spinner />{/if}
  {#if list && !list.length}<p class="message">Playlist neobsahuje žádné kanály.</p>{/if}
  {#each groups as [name, channels] (name)}
    <Row title={name}>
      {#each channels as ch (ch.id)}
        <Card landscape title={ch.name} image={ch.logo} fallback={ch.name} onclick={() => nav.push({ name: 'player', source: { kind: 'url', url: ch.url, title: ch.name, live: true } })} />
      {/each}
    </Row>
  {/each}
</Page>
