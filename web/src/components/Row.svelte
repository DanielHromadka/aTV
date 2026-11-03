<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  let { title, children, more }: { title: string; children: Snippet; more?: { label: string; onclick: () => void } } = $props()

  let track: HTMLDivElement | undefined = $state()
  const scroll = (dir: 1 | -1) => track?.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: 'smooth' })
</script>

<section class="row">
  <header class="row-head">
    <h2>{title}</h2>
    {#if more}<button class="link" onclick={more.onclick}>{more.label}</button>{/if}
    <span class="row-arrows">
      <button class="round small" aria-label="Posunout doleva" onclick={() => scroll(-1)}><Icon name="back" size={18} /></button>
      <button class="round small" aria-label="Posunout doprava" onclick={() => scroll(1)}><Icon name="forward" size={18} /></button>
    </span>
  </header>
  <div class="row-track" bind:this={track}>{@render children()}</div>
</section>
