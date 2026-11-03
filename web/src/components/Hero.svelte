<script lang="ts">
  import { greeting } from '../../../shared/context.ts'
  import { look } from '../lib/appearance.svelte.ts'
  import { czechDate, clock } from '../lib/clock.svelte.ts'
  import { hub } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'
  import type { TileDef } from '../lib/tiles.ts'
  import { ui } from '../lib/toast.svelte.ts'
  import AppTile from './AppTile.svelte'
  import Icon from './Icon.svelte'
  import Weather from './Weather.svelte'

  /** The top of the home screen in the chosen design: clock, buttons and the app tiles. */
  let { tiles }: { tiles: TileDef[] } = $props()

  const a = $derived(look.appearance)
  let previewId = $state<string | null>(null)
  const preview = $derived(tiles.find((t) => t.id === previewId) ?? tiles[0])
  const bigClock = $derived(a.design === 'dock' || a.design === 'minimal')
  const time = $derived(`${clock.now.getHours()}:${String(clock.now.getMinutes()).padStart(2, '0')}`)
  const sleepMin = $derived(hub.sleepEndsAt ? Math.max(1, Math.ceil((hub.sleepEndsAt - clock.now.getTime()) / 60_000)) : 0)
</script>

{#snippet heroClock(centered = false)}
  {#if a.clock !== 'hidden'}
    <div class="hero-clock clock-{a.clock}" class:centered>
      <time class="hero-time">{time}</time>
      <div class="hero-date">{czechDate(clock.now)}</div>
    </div>
  {/if}
{/snippet}

{#snippet tileRow(extra = '')}
  <div class="hero-row {extra}">
    {#each tiles as t (t.id)}<AppTile tile={t} look={a} />{/each}
  </div>
{/snippet}

<section class="home-hero hero-{a.design} tiles-{a.tiles} labels-{a.labels} font-{a.font}">
  <header class="hero-top">
    {#if bigClock}<div class="hero-spacer"></div>{:else}{@render heroClock()}{/if}
    <div class="hero-actions">
      {#if sleepMin}<span class="sleep-badge">☾ {sleepMin} min</span>{/if}
      <Weather />
      {#if !hub.connected}<span class="hero-offline">Hub nepřipojen</span>{/if}
      <button class="round-btn" aria-label="Hledat" onclick={() => nav.push({ name: 'search' })}><Icon name="search" size={32} /></button>
      <button class="round-btn" aria-label="Vzhled" onclick={() => (ui.appearanceOpen = true)}><Icon name="palette" size={32} /></button>
      <button class="round-btn" aria-label="Nastavení" onclick={() => nav.push({ name: 'settings' })}><Icon name="gear" size={32} /></button>
    </div>
  </header>

  {#if a.design === 'spotlight'}
    <div class="spot-copy">
      <div class="spot-kicker">{greeting(clock.now.getHours())}</div>
      <h1 class="spot-title">Na co se dnes podíváme?</h1>
    </div>
    {@render tileRow()}
  {:else if a.design === 'mosaic'}
    <div class="mosaic">
      {#if tiles[0]}<AppTile tile={tiles[0]} look={a} size="hero" />{/if}
      <div class="mosaic-rest">
        {#each tiles.slice(1) as t, i (t.id)}<AppTile tile={t} look={a} size={i < 2 ? 'wide' : 'small'} />{/each}
      </div>
    </div>
  {:else if a.design === 'sidebar'}
    <div class="sidebar">
      <div class="sidebar-list">
        {#each tiles as t (t.id)}
          <button class="side-item" onclick={() => nav.push(t.route)} onmouseenter={() => (previewId = t.id)} onfocus={() => (previewId = t.id)}>
            <span class="side-icon" style:background={a.tiles === 'brand' ? t.background : undefined}><Icon name={t.icon} size={30} /></span>
            <span class="side-name">{t.name}</span>
          </button>
        {/each}
      </div>
      {#if preview}
        <button class="side-preview" style:background={a.tiles === 'brand' ? preview.background : undefined} onclick={() => nav.push(preview.route)}>
          <span class="side-preview-icon"><Icon name={preview.icon} size={150} stroke={1.4} /></span>
          <span class="side-preview-name">{preview.name}</span>
          <span class="side-preview-hint">Kliknutím otevřete</span>
        </button>
      {/if}
    </div>
  {:else if a.design === 'dock'}
    {@render heroClock()}
    <div class="dock">{@render tileRow()}</div>
  {:else if a.design === 'minimal'}
    {@render heroClock(true)}
    {@render tileRow('minimal-strip')}
  {:else}
    <div class="app-grid">
      {#each tiles as t (t.id)}<AppTile tile={t} look={a} />{/each}
    </div>
  {/if}
</section>
