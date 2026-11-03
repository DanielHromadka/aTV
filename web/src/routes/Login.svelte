<script lang="ts">
  import Page from '../components/Page.svelte'
  import Spinner from '../components/Spinner.svelte'
  import { hub } from '../lib/hub.svelte.ts'
  import { jellyfinAuth } from '../lib/jellyfin.ts'
  import { nav } from '../lib/router.svelte.ts'
  import { settings, updateSettings, type JellyfinSession } from '../lib/settings.svelte.ts'
  import { toast } from '../lib/toast.svelte.ts'

  /** Jellyfin login: Quick Connect (approve a code in another Jellyfin app) or name and password. */
  let serverInput = $state(settings.jellyfinServer || hub.config?.jellyfinUrl || '')
  const server = $derived(settings.jellyfinServer || hub.config?.jellyfinUrl || '')
  let info = $state('')
  let error = $state('')
  let user = $state('')
  let password = $state('')
  let busy = $state(false)
  let quick = $state(false)
  let code = $state('')

  $effect(() => {
    const s = server
    info = ''
    error = ''
    if (!s) return
    let cancelled = false
    jellyfinAuth.publicInfo(s).then((i) => !cancelled && (info = `${i.ServerName} · Jellyfin ${i.Version}`), () => !cancelled && (error = 'Server neodpovídá. Zkontrolujte adresu.'))
    return () => (cancelled = true)
  })

  // Quick Connect: poll until the code is approved, then log in with the secret.
  $effect(() => {
    if (!quick) return
    code = ''
    let cancelled = false
    let secret = ''
    jellyfinAuth.quickConnectStart(server).then((r) => {
      secret = r.Secret
      if (!cancelled) code = r.Code
    }, () => {
      if (cancelled) return
      error = 'Quick Connect je na serveru vypnutý'
      quick = false
    })
    const t = setInterval(async () => {
      if (!secret) return
      try {
        if (!(await jellyfinAuth.quickConnectDone(server, secret))) return
        clearInterval(t)
        finish(await jellyfinAuth.withQuickConnect(server, secret))
      } catch {
        // Not approved yet, or the server blinked: keep polling.
      }
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  })

  function finish(session: JellyfinSession): void {
    updateSettings({ jellyfin: session, jellyfinServer: server })
    toast(`Přihlášeno jako ${session.userName}`)
    nav.back()
  }

  function saveServer(e: SubmitEvent): void {
    e.preventDefault()
    updateSettings({ jellyfinServer: serverInput.trim().replace(/\/+$/, '') })
  }

  async function login(e: SubmitEvent): Promise<void> {
    e.preventDefault()
    busy = true
    error = ''
    try {
      finish(await jellyfinAuth.withPassword(server, user, password))
    } catch {
      error = 'Špatné jméno nebo heslo'
    } finally {
      busy = false
    }
  }
</script>

<Page title="Přihlášení k Jellyfinu">
  <form class="form" onsubmit={saveServer}>
    <label>Server<input bind:value={serverInput} placeholder="http://192.168.0.10:8096" inputmode="url" autocomplete="url" /></label>
    <button class="btn" type="submit">Uložit adresu</button>
  </form>
  {#if info}<p class="muted">{info}</p>{/if}
  {#if error}<p class="message">{error}</p>{/if}

  {#if server && !error.startsWith('Server')}
    {#if quick}
      <div class="quick-connect">
        {#if code}
          <p class="muted">V aplikaci Jellyfin (mobil nebo web) otevřete Nastavení → Quick Connect a zadejte kód:</p>
          <div class="big-code">{code}</div>
          <Spinner label="Čekám na potvrzení…" />
        {:else}<Spinner />{/if}
        <button class="btn ghost" onclick={() => (quick = false)}>Zrušit</button>
      </div>
    {:else}
      <div class="login-options">
        <form class="form" onsubmit={login}>
          <h2 class="section">Jméno a heslo</h2>
          <label>Uživatelské jméno<input bind:value={user} autocomplete="username" required /></label>
          <label>Heslo<input type="password" bind:value={password} autocomplete="current-password" /></label>
          <button class="btn primary" type="submit" disabled={busy}>{busy ? 'Přihlašuji…' : 'Přihlásit'}</button>
        </form>
        <div class="form">
          <h2 class="section">Quick Connect</h2>
          <p class="muted">Přihlášení kódem, který potvrdíte v jiné aplikaci Jellyfin.</p>
          <button class="btn" onclick={() => { error = ''; quick = true }}>Získat kód</button>
        </div>
      </div>
    {/if}
  {/if}
</Page>
