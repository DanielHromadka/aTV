<script lang="ts">
  let {
    title,
    subtitle,
    image,
    progress,
    landscape = false,
    fallback,
    onclick,
  }: {
    title: string
    subtitle?: string
    image?: string
    /** 0–1, drawn as a bar along the bottom. */
    progress?: number
    landscape?: boolean
    /** Shown when there is no image. */
    fallback?: string
    onclick: () => void
  } = $props()

  let failed = $state(false)
</script>

<button class="card" class:card-wide={landscape} {onclick}>
  <span class="card-image">
    {#if image && !failed}
      <img src={image} alt="" loading="lazy" onerror={() => (failed = true)} />
    {:else}
      <span class="card-fallback">{fallback ?? title.slice(0, 1)}</span>
    {/if}
    {#if progress !== undefined && progress > 0}
      <span class="card-progress"><span style:width="{Math.min(progress, 1) * 100}%"></span></span>
    {/if}
  </span>
  <span class="card-title">{title}</span>
  {#if subtitle}<span class="card-subtitle">{subtitle}</span>{/if}
</button>
