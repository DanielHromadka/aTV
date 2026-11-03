<script lang="ts">
  import { CLOCKS, DESIGNS, findScene, FONTS, LABEL_STYLES, SCENES, sceneUrl, TILE_STYLES, type Appearance, type Option } from '../../../shared/appearance.ts'
  import { backgroundUrl, look, setAppearance } from '../lib/appearance.svelte.ts'
  import { hub } from '../lib/hub.svelte.ts'
  import { ui } from '../lib/toast.svelte.ts'
  import Icon from './Icon.svelte'
  import MiniDesign from './MiniDesign.svelte'

  /** "Make it yours": the same choices as the TV panel and the phone, shown over the page so changes are live. */
  const a = $derived(look.appearance)
  const backdrop = $derived(backgroundUrl(a.background, true))
  const photographer = $derived(findScene(a.background)?.photographer)

  const options: { key: 'tiles' | 'labels' | 'font' | 'clock'; label: string; list: Option<string>[] }[] = [
    { key: 'tiles', label: 'Dlaždice', list: TILE_STYLES },
    { key: 'labels', label: 'Popisky', list: LABEL_STYLES },
    { key: 'font', label: 'Písmo', list: FONTS },
    { key: 'clock', label: 'Hodiny', list: CLOCKS },
  ]

  const close = () => (ui.appearanceOpen = false)
  const pick = (patch: Partial<Appearance>) => setAppearance(patch)
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="look-backdrop" role="presentation" onclick={close}></div>
<aside class="look-panel" aria-label="Vzhled">
  <header class="look-head">
    <div>
      <div class="look-kicker">Vzhled</div>
      <h1 class="look-title">Udělejte si ji po svém</h1>
    </div>
    <button class="round" aria-label="Zavřít" onclick={close}><Icon name="close" /></button>
  </header>
  <p class="muted">Změny se ukládají hned a projeví se i na televizi a v mobilu.</p>

  <h2 class="look-section">Návrh</h2>
  <div class="design-grid">
    {#each DESIGNS as d (d.id)}
      <button class="design-card" class:on={d.id === a.design} aria-pressed={d.id === a.design} onclick={() => pick({ design: d.id })}>
        <span class="design-thumb" style:background-image={backdrop ? `url("${backdrop}")` : undefined}>
          <MiniDesign design={d.id} />
          {#if d.id === a.design}<span class="badge">Teď</span>{/if}
        </span>
        <strong>{d.name}</strong>
        <span>{d.description}</span>
      </button>
    {/each}
  </div>

  <h2 class="look-section">Pozadí</h2>
  <div class="bg-grid">
    {#each SCENES as s (s.id)}
      {@const id = `scene:${s.id}`}
      <button class="bg-tile" class:on={a.background === id} aria-pressed={a.background === id} style:background-image={`url("${sceneUrl(s, true)}")`} onclick={() => pick({ background: id })}>
        <span>{s.name}</span>
      </button>
    {/each}
    {#each look.backgrounds as p (p.id)}
      {@const id = `photo:${p.id}`}
      <button class="bg-tile" class:on={a.background === id} aria-pressed={a.background === id} style:background-image={`url("${backgroundUrl(id, true)}")`} onclick={() => pick({ background: id })}>
        <span>{p.name}</span>
      </button>
    {/each}
    {#if hub.config?.features.photos}
      <button class="bg-tile bg-plain" class:on={a.background === 'immich'} aria-pressed={a.background === 'immich'} onclick={() => pick({ background: 'immich' })}><span>Fotky z Immich</span></button>
    {/if}
    <button class="bg-tile bg-plain" class:on={a.background === 'none'} aria-pressed={a.background === 'none'} onclick={() => pick({ background: 'none' })}><span>Bez pozadí</span></button>
  </div>
  <p class="muted small">
    Vlastní fotky na pozadí nahrajete z mobilu: ovladač → Vzhled.
    {#if photographer}Foto: {photographer} (Unsplash, CC0).{/if}
  </p>

  <h2 class="look-section">Úpravy</h2>
  {#each options as o (o.key)}
    <div class="look-option">
      <div class="look-option-label">{o.label}</div>
      <div class="segmented" role="radiogroup" aria-label={o.label}>
        {#each o.list as opt (opt.id)}
          <button role="radio" aria-checked={a[o.key] === opt.id} class:on={a[o.key] === opt.id} onclick={() => pick({ [o.key]: opt.id })}>{opt.name}</button>
        {/each}
      </div>
    </div>
  {/each}
  {#if !hub.connected}<p class="muted small">Bez hubu se vzhled uloží jen v tomto prohlížeči.</p>{/if}
</aside>
