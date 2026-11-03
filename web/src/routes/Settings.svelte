<script lang="ts">
  import qrcode from 'qrcode-generator'
  import { LANGUAGE_NAMES } from '../../../shared/media.ts'
  import Icon from '../components/Icon.svelte'
  import Page from '../components/Page.svelte'
  import { clock } from '../lib/clock.svelte.ts'
  import { connectHub, hub, hubUrl, setSleep } from '../lib/hub.svelte.ts'
  import { nav } from '../lib/router.svelte.ts'
  import { settings, updateSettings } from '../lib/settings.svelte.ts'
  import { tileLayout } from '../lib/tiles.ts'
  import { toast, ui } from '../lib/toast.svelte.ts'

  const SCREENSAVER = [0, 2, 5, 10, 15, 30]
  const LANGS = ['cs', 'sk', 'en', 'de']

  let hubInput = $state(settings.hubUrl)
  const layout = $derived(tileLayout(settings))
  const sleepLeft = $derived(hub.sleepEndsAt ? Math.ceil((hub.sleepEndsAt - clock.now.getTime()) / 60_000) : 0)

  const qr = $derived.by(() => {
    if (!hub.pairing) return ''
    const q = qrcode(0, 'M')
    q.addData(hub.pairing.url)
    q.make()
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true })
  })

  function saveHub(e: SubmitEvent): void {
    e.preventDefault()
    updateSettings({ hubUrl: hubInput.trim().replace(/\/+$/, '') })
    connectHub()
  }

  const order = () => layout.map((t) => ({ id: t.def.id, hidden: t.hidden }))
  function moveTile(i: number, by: number): void {
    const list = order()
    const j = i + by
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    updateSettings({ tiles: list })
  }
  function toggleTile(i: number): void {
    const list = order()
    if (list[i].id === 'settings') return toast('Nastavení zůstává vždy viditelné')
    list[i].hidden = !list[i].hidden
    updateSettings({ tiles: list })
  }
  function sleep(minutes: number | null): void {
    if (!setSleep(minutes)) return toast('Časovač vypnutí potřebuje hub')
    if (minutes) toast(`Televize se vypne za ${minutes} min`)
  }
</script>

<Page title="Nastavení">
  <section class="settings-section">
    <h2 class="section">Ovladač v mobilu</h2>
    {#if hub.connected && hub.pairing}
      <div class="pairing">
        <div class="qr">{@html qr}</div>
        <div>
          <p class="muted">Naskenujte QR kód mobilem, nebo otevřete</p>
          <div class="pair-url">{hub.pairing.url.replace(/#.*$/, '')}</div>
          <p class="muted">a zadejte kód</p>
          <div class="big-code">{hub.pairing.code}</div>
        </div>
      </div>
    {:else}
      <p class="muted">Ovladač v mobilu, hlasové příkazy a ovládání televize potřebují hub (aTV hub na počítači nebo NASu).</p>
    {/if}
    <form class="setting-row" onsubmit={saveHub}>
      <label for="hub-url">Adresa hubu <span class="muted small">{hubUrl() || 'nenastaveno'} · {hub.connected ? 'připojeno' : 'odpojeno'}</span></label>
      <span class="setting-inline">
        <input id="hub-url" bind:value={hubInput} placeholder="prázdné = tento server" inputmode="url" />
        <button class="btn" type="submit">Uložit</button>
      </span>
    </form>
  </section>

  <section class="settings-section">
    <h2 class="section">Jellyfin</h2>
    {#if settings.jellyfin}
      <div class="setting-row">
        <span>Přihlášen <span class="muted small">{settings.jellyfin.userName} @ {settings.jellyfin.server}</span></span>
        <button class="btn" onclick={() => updateSettings({ jellyfin: null })}>Odhlásit</button>
      </div>
    {:else}
      <div class="setting-row">
        <span>Přihlásit k Jellyfinu <span class="muted small">{settings.jellyfinServer || hub.config?.jellyfinUrl || ''}</span></span>
        <button class="btn primary" onclick={() => nav.push({ name: 'login' })}>Přihlásit</button>
      </div>
    {/if}
  </section>

  <section class="settings-section">
    <h2 class="section">Jazyk filmů</h2>
    <div class="setting-row">
      <span>Preferovaný zvuk a titulky</span>
      <span class="segmented">
        {#each LANGS as l (l)}<button class:on={settings.prefLang === l} onclick={() => updateSettings({ prefLang: l })}>{LANGUAGE_NAMES[l] ?? l}</button>{/each}
      </span>
    </div>
  </section>

  <section class="settings-section">
    <h2 class="section">Časovač vypnutí televize</h2>
    <div class="buttons">
      {#each [15, 30, 60, 90] as m (m)}<button class="btn" onclick={() => sleep(m)}>{m} min</button>{/each}
      <button class="btn ghost" onclick={() => sleep(null)}>{sleepLeft ? `Zrušit (zbývá ${sleepLeft} min)` : 'Vypnuto'}</button>
    </div>
  </section>

  <section class="settings-section">
    <h2 class="section">Spořič obrazovky</h2>
    <div class="setting-row">
      <span>Spustit po nečinnosti {#if hub.config?.features.photos}<span class="muted small">fotky z Immich</span>{/if}</span>
      <span class="segmented">
        {#each SCREENSAVER as m (m)}<button class:on={settings.screensaverMinutes === m} onclick={() => updateSettings({ screensaverMinutes: m })}>{m ? `${m} min` : 'Vypnuto'}</button>{/each}
      </span>
    </div>
  </section>

  <section class="settings-section">
    <h2 class="section">Domovská obrazovka</h2>
    <div class="setting-row">
      <span>Vzhled <span class="muted small">Návrh, pozadí, dlaždice, písmo</span></span>
      <button class="btn primary" onclick={() => (ui.appearanceOpen = true)}><Icon name="palette" size={18} /> Upravit vzhled</button>
    </div>
    <p class="muted">Kliknutím na název dlaždici skryjete nebo zobrazíte, šipkami měníte pořadí.</p>
    <ol class="tile-list">
      {#each layout as t, i (t.def.id)}
        <li class:off={t.hidden}>
          <span class="tile-swatch" style:background={t.def.background}><Icon name={t.def.icon} size={20} /></span>
          <button class="tile-toggle" onclick={() => toggleTile(i)} aria-pressed={!t.hidden}>
            <span>{t.def.name}</span>
            <span class="muted small">{t.hidden ? 'skryto' : 'zobrazeno'}</span>
          </button>
          <button class="round small" aria-label="Posunout {t.def.name} nahoru" disabled={i === 0} onclick={() => moveTile(i, -1)}><Icon name="up" size={16} /></button>
          <button class="round small" aria-label="Posunout {t.def.name} dolů" disabled={i === layout.length - 1} onclick={() => moveTile(i, 1)}><Icon name="down" size={16} /></button>
        </li>
      {/each}
    </ol>
  </section>

  <section class="settings-section">
    <h2 class="section">O aplikaci</h2>
    <p class="muted">aTV 0.1.0 · webová aplikace</p>
    <img src="./credits/tmdb.svg" alt="TMDB" width="110" height="48" />
    <p class="muted small">Filmová metadata a fotografie: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
  </section>
</Page>
