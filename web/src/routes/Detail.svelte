<script lang="ts">
  import { formatTime, ticksToSeconds } from '../../../shared/context.ts'
  import Card from '../components/Card.svelte'
  import Icon from '../components/Icon.svelte'
  import Page from '../components/Page.svelte'
  import Row from '../components/Row.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { playItem } from '../lib/actions.ts'
  import { isPlayable, itemTitle, jellyfin, type Item } from '../lib/jellyfin.ts'
  import { nav } from '../lib/router.svelte.ts'

  /** One title: description, play buttons, actors, and episodes or other children. */
  let { itemId }: { itemId: string } = $props()

  const jf = jellyfin()
  let item = $state<Item | null>(null)
  let children = $state<Item[]>([])
  let nextUp = $state<Item | null>(null)
  let error = $state('')

  $effect(() => {
    if (!jf) return
    let cancelled = false
    jf.item(itemId)
      .then(async (it) => {
        if (cancelled) return
        item = it
        if (it.Type === 'Series') {
          const [eps, next] = await Promise.all([jf.episodes(it.Id), jf.nextUp(it.Id)])
          if (!cancelled) [children, nextUp] = [eps, next[0] ?? null]
        } else if (it.IsFolder) {
          const kids = await jf.children(it.Id)
          if (!cancelled) children = kids
        }
      })
      .catch((e: Error) => !cancelled && (error = e.message))
    return () => (cancelled = true)
  })

  const backdrop = $derived(
    !item || !jf ? undefined
      : item.BackdropImageTags?.length ? jf.image(item.Id, 'Backdrop', 1080, item.BackdropImageTags[0])
      : item.ParentBackdropItemId ? jf.image(item.ParentBackdropItemId, 'Backdrop', 1080, item.ParentBackdropImageTags?.[0])
      : undefined,
  )
  const position = $derived(ticksToSeconds(item?.UserData?.PlaybackPositionTicks))
  const meta = $derived(item ? [
    item.ProductionYear,
    item.RunTimeTicks ? formatTime(ticksToSeconds(item.RunTimeTicks)) : undefined,
    item.OfficialRating,
    item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : undefined,
  ].filter(Boolean).join('  ·  ') : '')

  // Episodes grouped by season, one row each.
  const seasons = $derived.by(() => {
    const out: { name: string; items: Item[] }[] = []
    for (const c of children) {
      const name = item?.Type === 'Series' ? c.SeasonName ?? `Řada ${c.ParentIndexNumber ?? '?'}` : 'Obsah'
      const last = out.at(-1)
      if (last?.name === name) last.items.push(c)
      else out.push({ name, items: [c] })
    }
    return out
  })
  const actors = $derived(item?.People?.filter((p) => p.Type === 'Actor') ?? [])
</script>

{#if backdrop}<div class="backdrop" style:background-image={`url("${backdrop}")`}></div>{/if}
<Page title={item ? item.SeriesName ?? item.Name : 'Detail'} subtitle={item?.SeriesName ? itemTitle(item) : undefined}>
  {#if !jf}<p class="message">Přihlaste se do knihovny Jellyfin.</p>
  {:else if error}<p class="message">{error}</p>
  {:else if !item}<Spinner />
  {:else}
    <div class="detail-info">
      {#if meta}<div class="detail-meta">{meta}</div>{/if}
      {#if item.Overview}<p class="detail-overview">{item.Overview}</p>{/if}
      <div class="buttons">
        {#if isPlayable(item) && position > 0}
          <button class="btn primary" onclick={() => item && void playItem(item)}><Icon name="start" size={18} /> Pokračovat od {formatTime(position)}</button>
        {/if}
        {#if isPlayable(item)}
          <button class="btn" class:primary={position === 0} onclick={() => item && void playItem(item, true)}>{#if position === 0}<Icon name="start" size={18} /> Přehrát{:else}Od začátku{/if}</button>
        {/if}
        {#if item.Type === 'Series' && nextUp}
          <button class="btn primary" onclick={() => nextUp && void playItem(nextUp)}><Icon name="start" size={18} /> {itemTitle(nextUp)}</button>
        {/if}
      </div>
    </div>
    {#if actors.length}
      <Row title="Hrají">
        {#each actors as p (p.Id)}
          <Card title={p.Name} subtitle={p.Role} fallback={p.Name} image={p.PrimaryImageTag ? jf.image(p.Id, 'Primary', 360, p.PrimaryImageTag) : undefined}
            onclick={() => nav.push({ name: 'actor', actor: { id: p.Id, name: p.Name, source: 'jellyfin', knownFor: p.Role, photo: p.PrimaryImageTag ? jf.image(p.Id, 'Primary', 360, p.PrimaryImageTag) : undefined } })} />
        {/each}
      </Row>
    {/if}
    {#each seasons as s (s.name)}
      <Row title={s.name}>
        {#each s.items as c (c.Id)}
          <Card landscape={c.Type === 'Episode' || c.MediaType === 'Video'} title={c.Type === 'Episode' ? itemTitle(c) : c.Name}
            image={jf.cardImage(c, c.Type === 'Episode', 270)} progress={(c.UserData?.PlayedPercentage ?? 0) / 100}
            subtitle={c.UserData?.Played ? '✓ Zhlédnuto' : undefined}
            onclick={() => (isPlayable(c) ? void playItem(c) : nav.push({ name: 'detail', itemId: c.Id }))} />
        {/each}
      </Row>
    {/each}
  {/if}
</Page>
