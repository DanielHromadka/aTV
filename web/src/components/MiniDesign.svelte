<script lang="ts">
  import type { DesignId } from '../../../shared/appearance.ts'

  /** A schematic of a design, drawn over the chosen background. */
  let { design }: { design: DesignId } = $props()

  const SWATCHES = ['#e50914', '#ff3b30', '#1a73e8', '#1a3cd6', '#2ed3c3', '#f6ad55', '#7b2ff7', '#c6f432']
  const n = (count: number) => Array.from({ length: count }, (_, i) => SWATCHES[i % SWATCHES.length])
</script>

<span class="mini mini-{design}">
  {#if design === 'spotlight'}
    <b class="mini-headline"></b><b class="mini-headline short"></b>
    <span class="mini-row">{#each n(4) as c, i (i)}<i style:background={c}></i>{/each}</span>
  {:else if design === 'mosaic'}
    <i class="mini-big" style:background={SWATCHES[0]}></i>
    <span class="mini-rest">{#each n(6) as c, i (i)}<i style:background={c}></i>{/each}</span>
  {:else if design === 'sidebar'}
    <span class="mini-list">{#each n(6) as c, i (i)}<i style:background={c}></i>{/each}</span>
    <i class="mini-preview" style:background={SWATCHES[3]}></i>
  {:else if design === 'dock' || design === 'minimal'}
    <b class="mini-clock"></b>
    <span class="mini-row">{#each n(design === 'dock' ? 5 : 6) as _, i (i)}<i class="glass"></i>{/each}</span>
  {:else}
    <span class="mini-grid">{#each n(design === 'shore' ? 8 : 10) as c, i (i)}<i class:glass={design === 'shore'} style:background={design === 'shore' ? undefined : c}></i>{/each}</span>
  {/if}
</span>
