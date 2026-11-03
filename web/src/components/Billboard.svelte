<script lang="ts">
  import type { Snippet } from 'svelte'
  import { nav } from '../lib/router.svelte.ts'
  import Icon from './Icon.svelte'

  /** A film's full-width artwork with the title, details and actions over its darkened left side. */
  let { image, title, children }: { image?: string; title: string; children: Snippet } = $props()

  let failed = $state(false)
</script>

<section class="bb" class:bb-plain={!image || failed}>
  {#if image && !failed}<img class="bb-image" src={image} alt="" onerror={() => (failed = true)} />{/if}
  <div class="bb-shade"></div>
  <nav class="bb-nav">
    <button class="nf-circle dark" aria-label="Zpět" onclick={nav.back}><Icon name="back" size={22} /></button>
    <button class="nf-circle dark" aria-label="Domů" onclick={nav.home}><Icon name="home" size={20} /></button>
  </nav>
  <div class="bb-body">
    <h1 class="bb-title">{title}</h1>
    {@render children()}
  </div>
</section>
