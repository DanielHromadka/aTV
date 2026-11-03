<script lang="ts">
  import Card from '../components/Card.svelte'
  import Page from '../components/Page.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { jellyfin, type Item } from '../lib/jellyfin.ts'
  import { nav } from '../lib/router.svelte.ts'
  import { settings } from '../lib/settings.svelte.ts'

  /** Without a parent: the user's libraries. With one: its content as a poster grid. */
  let { parentId, title, collectionType }: { parentId?: string; title?: string; collectionType?: string } = $props()

  const jf = $derived(settings.jellyfin ? jellyfin() : null)
  let items = $state<Item[] | null>(null)
  let error = $state('')

  $effect(() => {
    const client = jf
    if (!client) return
    let cancelled = false
    items = null
    ;(parentId ? client.items(parentId, collectionType) : client.views()).then(
      (list) => !cancelled && (items = list),
      (e: Error) => !cancelled && (error = e.message),
    )
    return () => (cancelled = true)
  })

  const landscape = $derived(!parentId)
</script>

<Page title={title ?? 'Knihovna'}>
  {#if !jf}
    <p class="message">Knihovna používá Jellyfin, open-source mediální server. Přihlaste se ke svému serveru.</p>
    <button class="btn primary" onclick={() => nav.push({ name: 'login' })}>Přihlásit k Jellyfinu</button>
  {:else}
    {#if error}<p class="message">{error}</p>{/if}
    {#if !items && !error}<Spinner />{/if}
    {#if items && !items.length}<p class="message">Tady zatím nic není.</p>{/if}
    <div class="grid" class:grid-wide={landscape}>
      {#each items ?? [] as i (i.Id)}
        <Card {landscape} title={i.Name} subtitle={i.ProductionYear ? String(i.ProductionYear) : undefined}
          image={jf.cardImage(i, landscape, landscape ? 270 : 360)} progress={(i.UserData?.PlayedPercentage ?? 0) / 100}
          onclick={() => parentId
            ? nav.push({ name: 'detail', itemId: i.Id })
            : nav.push({ name: 'library', parentId: i.Id, title: i.Name, collectionType: i.CollectionType })} />
      {/each}
    </div>
  {/if}
</Page>
