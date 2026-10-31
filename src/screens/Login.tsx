import { useEffect, useState } from 'preact/hooks'
import { Button, Message, Spinner } from '../components'
import { config, nav, toast, useStore } from '../state'
import { jellyfinAuth } from '../services/jellyfin'
import { settings, updateSettings } from '../services/settings'

type Step = { kind: 'server' } | { kind: 'quick'; code: string } | { kind: 'busy' }

/** Jellyfin login: Quick Connect (approve a code in the Jellyfin app) or name and password typed on the keyboard. */
export function Login() {
  const s = useStore(settings)
  const c = useStore(config)
  const server = s.jellyfinServer || c?.jellyfinUrl || ''
  const [step, setStep] = useState<Step>({ kind: 'server' })
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [user, setUser] = useState('')

  useEffect(() => {
    if (!server) return
    setInfo('')
    setError('')
    jellyfinAuth.publicInfo(server).then(
      (i) => setInfo(`${i.ServerName} · Jellyfin ${i.Version}`),
      () => setError('Server neodpovídá. Zkontrolujte adresu.'),
    )
  }, [server])

  // Quick Connect: poll until the user approves the code, then log in with the secret.
  useEffect(() => {
    if (step.kind !== 'quick') return
    let cancelled = false
    let secret = ''
    jellyfinAuth
      .quickConnectStart(server)
      .then((r) => {
        secret = r.Secret
        if (!cancelled) setStep({ kind: 'quick', code: r.Code })
      })
      .catch(() => {
        if (cancelled) return
        setError('Quick Connect je na serveru vypnutý')
        setStep({ kind: 'server' })
      })
    const t = window.setInterval(async () => {
      if (!secret) return
      try {
        if (!(await jellyfinAuth.quickConnectDone(server, secret))) return
        window.clearInterval(t)
        finish(await jellyfinAuth.withQuickConnect(server, secret))
      } catch {
        // Not approved yet, or the server blinked: keep polling.
      }
    }, 3000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [step.kind === 'quick'])

  function finish(session: Parameters<typeof updateSettings>[0]['jellyfin']) {
    updateSettings({ jellyfin: session, jellyfinServer: server })
    toast(`Přihlášeno jako ${session?.userName}`)
    nav.pop()
  }

  const editServer = () =>
    nav.push({ type: 'keyboard', title: 'Adresa Jellyfin serveru', value: server || 'http://', onDone: (v) => updateSettings({ jellyfinServer: v.replace(/\/+$/, '') }) })

  const askPassword = () =>
    nav.push({
      type: 'keyboard',
      title: 'Uživatelské jméno',
      value: user,
      onDone: (name) => {
        setUser(name)
        // The second keyboard opens after the first one has closed.
        setTimeout(() =>
          nav.push({
            type: 'keyboard',
            title: `Heslo pro ${name}`,
            value: '',
            secret: true,
            onDone: (pw) => {
              setStep({ kind: 'busy' })
              jellyfinAuth.withPassword(server, name, pw).then(finish, () => {
                setError('Špatné jméno nebo heslo')
                setStep({ kind: 'server' })
              })
            },
          }),
        )
      },
    })

  return (
    <div class="screen-body padded">
      <h1 class="screen-title">Přihlášení k Jellyfinu</h1>
      <div class="settings-row" data-focus="server" data-autofocus={!server ? '' : undefined} onClick={editServer}>
        <span>Server</span>
        <span class="value">{server || 'nenastaveno'}</span>
      </div>
      {info && <div class="muted">{info}</div>}
      {error && <Message>{error}</Message>}
      {step.kind === 'quick' && (
        <div class="quick-connect">
          {step.code ? (
            <>
              <div class="muted">V aplikaci Jellyfin (mobil nebo web) otevřete Nastavení → Quick Connect a zadejte kód:</div>
              <div class="big-code">{step.code}</div>
              <Spinner label="Čekám na potvrzení…" />
            </>
          ) : (
            <Spinner />
          )}
        </div>
      )}
      {step.kind === 'busy' && <Spinner label="Přihlašuji…" />}
      {server && step.kind === 'server' && !error.startsWith('Server') && (
        <div class="buttons">
          <Button id="quick" primary autofocus label="Quick Connect (kód)" onClick={() => { setError(''); setStep({ kind: 'quick', code: '' }) }} />
          <Button id="password" label="Jméno a heslo" onClick={askPassword} />
        </div>
      )}
    </div>
  )
}
