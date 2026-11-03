<script lang="ts">
  import { GALLERY_INTERVALS, galleryNext, type ArtArtist } from '../../../shared/art.ts'
  import Icon from '../components/Icon.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { hubApi, hubUrl } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'

  /** Full-screen slideshow of one artist's works; arrows move, space pauses, the interval is remembered. */
  let { artistId, start }: { artistId: string; start: number } = $props()

  const KEY = 'atv.gallery.interval'
  const saved = () => {
    try {
      const n = Number(localStorage.getItem(KEY) ?? 60)
      return GALLERY_INTERVALS.includes(n) ? n : 60
    } catch {
      return 60
    }
  }

  let data = $state<ArtArtist | null>(null)
  let error = $state('')
  // svelte-ignore state_referenced_locally
  let index = $state(start)
  let seconds = $state(saved())
  let paused = $state(false)
  let loaded = $state(false)
  let failed = $state(false)
  let hud = $state(true)
  let previous = $state<string | null>(null)
  let hideTimer: ReturnType<typeof setTimeout> | undefined

  const image = (id: string) => `${hubUrl()}/api/art/images/${id}`
  const work = $derived(data?.works[galleryNext(index, data.works.length)])
  const intervalLabel = (n: number) => (n === 0 ? 'Bez střídání' : n < 60 ? `${n} s` : n < 3600 ? `${n / 60} min` : `${n / 3600} h`)

  $effect(() => {
    hubApi<ArtArtist>(`/api/art/artists/${artistId}`).then((d) => (data = d), () => (error = 'Díla nelze načíst. Zkuste to znovu.'))
  })

  function show(): void {
    hud = true
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => (hud = false), 4000)
  }
  function move(delta: number): void {
    if (!data) return
    const target = galleryNext(index, data.works.length, delta)
    if (target === index) return
    previous = work ? image(work.id) : null
    loaded = false
    failed = false
    index = target
  }

  $effect(() => {
    show()
    return () => clearTimeout(hideTimer)
  })
  $effect(() => {
    if (!work || !loaded || paused || !seconds) return
    const t = setTimeout(() => move(1), seconds * 1000)
    return () => clearTimeout(t)
  })
  // The next work loads in the background.
  $effect(() => {
    if (!data || data.works.length < 2) return
    new Image().src = image(data.works[galleryNext(index, data.works.length, 1)].id)
  })
  $effect(() => {
    try {
      localStorage.setItem(KEY, String(seconds))
    } catch {
      // The interval then lasts only for this session.
    }
  })

  function onKey(e: KeyboardEvent): void {
    show()
    if (e.key === 'ArrowLeft') move(-1)
    else if (e.key === 'ArrowRight') move(1)
    else if (e.key === ' ') paused = !paused
    else if (e.key === 'Escape') nav.back()
    else return
    e.preventDefault()
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="gallery" class:idle={!hud && !failed} role="presentation" onpointermove={show}>
  {#if previous}<img class="gallery-image" src={previous} alt="" aria-hidden="true" />{/if}
  {#if work}
    {#key work.id}
      <img class="gallery-image gallery-current" class:ready={loaded} src={image(work.id)} alt="{work.title} — {work.artist}"
        onload={() => (loaded = true)} onerror={() => { loaded = false; failed = true; hud = true }} />
    {/key}
  {/if}
  {#if error || failed}<div class="player-center"><p class="message">{error || 'Obraz není dostupný. Přejděte na další dílo.'}</p></div>{/if}
  {#if !loaded && !previous && !error && !failed}<div class="player-center"><Spinner label="Načítám dílo…" /></div>{/if}

  <button class="round gallery-nav prev" aria-label="Předchozí dílo" onclick={() => move(-1)}><Icon name="back" /></button>
  <button class="round gallery-nav next" aria-label="Další dílo" onclick={() => move(1)}><Icon name="forward" /></button>
  <div class="gallery-hud" class:show={hud || failed}>
    <button class="round" aria-label="Zpět" onclick={nav.back}><Icon name="back" /></button>
    <div class="gallery-caption">
      <h1>{work?.title}</h1>
      <p>{work?.artist} · {work?.date} · Wikimedia Commons</p>
    </div>
    <button class="btn" onclick={() => (paused = !paused)}><Icon name={paused ? 'start' : 'pause'} size={18} /> {paused ? 'Pokračovat' : 'Pozastavit'}</button>
    <label class="gallery-interval">
      Doba zobrazení
      <select bind:value={seconds}>
        {#each GALLERY_INTERVALS as n (n)}<option value={n}>{intervalLabel(n)}</option>{/each}
      </select>
    </label>
  </div>
</div>
