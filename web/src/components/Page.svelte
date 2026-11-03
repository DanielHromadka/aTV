<script lang="ts">
  import type { Snippet } from 'svelte'
  import { nav } from '../lib/router.svelte.ts'
  import Icon from './Icon.svelte'

  /** A page with Back and Home, the title and its content. */
  let { title, subtitle, children, actions }: { title: string; subtitle?: string; children: Snippet; actions?: Snippet } = $props()
</script>

<div class="page">
  <header class="page-head">
    <button class="round" aria-label="Zpět" onclick={nav.back}><Icon name="back" /></button>
    <div class="page-titles">
      <h1>{title}</h1>
      {#if subtitle}<p class="muted">{subtitle}</p>{/if}
    </div>
    {#if actions}{@render actions()}{/if}
    <button class="round" aria-label="Domů" onclick={nav.home}><Icon name="home" /></button>
  </header>
  {@render children()}
</div>
