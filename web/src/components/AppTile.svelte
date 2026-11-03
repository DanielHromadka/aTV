<script lang="ts">
  import type { Appearance } from '../../../shared/appearance.ts'
  import { nav } from '../lib/router.svelte.ts'
  import type { TileDef } from '../lib/tiles.ts'
  import Icon from './Icon.svelte'

  let { tile, look, size, onfocus }: { tile: TileDef; look: Appearance; size?: 'hero' | 'wide' | 'small'; onfocus?: () => void } = $props()

  const below = $derived(look.design === 'icons' || look.design === 'minimal')
  const iconSize = $derived(size === 'hero' ? 120 : size === 'small' ? 56 : 72)
</script>

<button class="app-tile {size ? `app-${size}` : ''}" onclick={() => nav.push(tile.route)} onmouseenter={onfocus} {onfocus} aria-label={tile.name}>
  <span class="app-face" style:background={look.tiles === 'brand' ? tile.background : undefined} style:--glow={tile.glow}>
    {#if look.labels !== 'name'}<span class="app-icon"><Icon name={tile.icon} size={iconSize} stroke={1.6} /></span>{/if}
    {#if look.labels !== 'icon' && !below}<span class="app-name">{tile.name}</span>{/if}
  </span>
  {#if look.labels !== 'icon' && below}<span class="app-caption">{tile.name}</span>{/if}
</button>
