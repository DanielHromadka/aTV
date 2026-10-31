import qrcode from 'qrcode-generator'
import { setSleep } from '../actions'
import { Button } from '../components'
import { platform } from '../runtime'
import { config, hubStatus, nav, toast, useStore } from '../state'
import { connectHub, hubUrl } from '../services/hub'
import { settings, updateSettings, type VirtualMouse } from '../services/settings'
import { tileLayout } from '../tiles'
import { LANGUAGE_NAMES } from '../../shared/media.ts'

const SCREENSAVER = [0, 2, 5, 10, 15, 30]
const LANGS = ['cs', 'sk', 'en', 'de']
const MOUSE: { value: VirtualMouse; label: string }[] = [
  { value: 'browser', label: 'jen v prohlížeči' },
  { value: 'all', label: 'všude' },
  { value: 'off', label: 'vypnuto' },
]

function Qr({ text }: { text: string }) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return <div class="qr" dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) }} />
}

function SettingRow({ id, label, value, onClick }: { id: string; label: string; value?: string; onClick: () => void }) {
  return (
    <div class="settings-row" data-focus={id} onClick={onClick}>
      <span>{label}</span>
      {value !== undefined && <span class="value">{value}</span>}
    </div>
  )
}

export function Settings() {
  const s = useStore(settings)
  const c = useStore(config)
  const hub = useStore(hubStatus)
  const layout = tileLayout(s)

  const moveTile = (i: number, by: number) => {
    const order = layout.map((t) => ({ id: t.def.id, hidden: t.hidden }))
    const j = i + by
    if (j < 0 || j >= order.length) return
    const tmp = order[i]
    order[i] = order[j]
    order[j] = tmp
    updateSettings({ tiles: order })
  }
  const toggleTile = (i: number) => {
    const order = layout.map((t) => ({ id: t.def.id, hidden: t.hidden }))
    if (order[i].id === 'settings') return toast('Nastavení zůstává vždy viditelné')
    order[i].hidden = !order[i].hidden
    updateSettings({ tiles: order })
  }

  const sleepLeft = hub.sleepEndsAt ? Math.ceil((hub.sleepEndsAt - Date.now()) / 60_000) : 0

  return (
    <div class="screen-body padded settings" data-scroll="y">
      <h1 class="screen-title">Nastavení</h1>

      <h2 class="section">Ovladač v mobilu</h2>
      {hub.connected && hub.pairing ? (
        <div class="pairing">
          <Qr text={hub.pairing.url} />
          <div>
            <div class="muted">Naskenujte QR kód mobilem, nebo otevřete</div>
            <div class="pair-url">{hub.pairing.url.replace(/#.*$/, '')}</div>
            <div class="muted">a zadejte kód</div>
            <div class="big-code">{hub.pairing.code}</div>
          </div>
        </div>
      ) : (
        <div class="muted">Ovladač v mobilu, hlasové příkazy a ovládání televize potřebují hub (aTV hub na počítači nebo NASu).</div>
      )}
      <SettingRow
        id="hub"
        label="Adresa hubu"
        value={`${hubUrl() || 'nenastaveno'} · ${hub.connected ? 'připojeno' : 'odpojeno'}`}
        onClick={() =>
          nav.push({
            type: 'keyboard',
            title: 'Adresa hubu (např. http://192.168.0.10:8090)',
            value: s.hubUrl || 'http://',
            onDone: (v) => {
              updateSettings({ hubUrl: v === 'http://' ? '' : v.replace(/\/+$/, '') })
              connectHub()
            },
          })
        }
      />

      <h2 class="section">Jellyfin</h2>
      {s.jellyfin ? (
        <>
          <SettingRow id="jf-user" label="Přihlášen" value={`${s.jellyfin.userName} @ ${s.jellyfin.server}`} onClick={() => {}} />
          <SettingRow id="jf-logout" label="Odhlásit" onClick={() => updateSettings({ jellyfin: null })} />
        </>
      ) : (
        <SettingRow id="jf-login" label="Přihlásit k Jellyfinu" value={s.jellyfinServer || c?.jellyfinUrl || ''} onClick={() => nav.push({ type: 'login' })} />
      )}

      <h2 class="section">Jazyk filmů</h2>
      <SettingRow
        id="lang"
        label="Preferovaný zvuk a titulky"
        value={LANGUAGE_NAMES[s.prefLang] ?? s.prefLang}
        onClick={() => updateSettings({ prefLang: LANGS[(LANGS.indexOf(s.prefLang) + 1) % LANGS.length] })}
      />

      <h2 class="section">Ovládání</h2>
      <SettingRow
        id="mouse"
        label="Virtuální myš (šipky hýbou kurzorem, OK kliká)"
        value={MOUSE.find((m) => m.value === s.virtualMouse)?.label}
        onClick={() => {
          const i = MOUSE.findIndex((m) => m.value === s.virtualMouse)
          updateSettings({ virtualMouse: MOUSE[(i + 1) % MOUSE.length].value })
        }}
      />
      <div class="muted">Ve „všude“ šipky na okraji obrazovky posunou obsah. V přehrávači šipky dál přetáčejí. Bez myši se v prohlížeči přeskakuje po odkazech.</div>

      <h2 class="section">Časovač vypnutí</h2>
      <div class="buttons">
        {[15, 30, 60, 90].map((m) => (
          <Button key={m} id={`sleep-${m}`} label={`${m} min`} onClick={() => { setSleep(m); toast(`Vypnu za ${m} min`) }} />
        ))}
        <Button id="sleep-off" label={sleepLeft ? `Zrušit (zbývá ${sleepLeft} min)` : 'Vypnuto'} onClick={() => setSleep(null)} />
      </div>

      <h2 class="section">Spořič obrazovky</h2>
      <SettingRow
        id="saver"
        label="Spustit po nečinnosti"
        value={s.screensaverMinutes ? `${s.screensaverMinutes} min${c?.features.photos ? ' · fotky z Immich' : ''}` : 'vypnuto'}
        onClick={() => {
          const i = SCREENSAVER.indexOf(s.screensaverMinutes)
          updateSettings({ screensaverMinutes: SCREENSAVER[(i + 1) % SCREENSAVER.length] })
        }}
      />

      <h2 class="section">Domovská obrazovka</h2>
      <SettingRow id="appearance" label="Vzhled" value="Návrh, pozadí, dlaždice, písmo" onClick={() => nav.push({ type: 'appearance' })} />
      <div class="muted">OK na názvu skryje nebo zobrazí dlaždici, šipky ▲ ▼ mění pořadí.</div>
      {layout.map((t, i) => (
        <div class="tile-setting" key={t.def.id}>
          <div class={`settings-row grow${t.hidden ? ' off' : ''}`} data-focus={`t-${t.def.id}`} onClick={() => toggleTile(i)}>
            <span>{t.def.name}</span>
            <span class="value">{t.hidden ? 'skryto' : 'zobrazeno'}</span>
          </div>
          <div class="btn btn-small" data-focus={`t-up-${t.def.id}`} onClick={() => moveTile(i, -1)}>▲</div>
          <div class="btn btn-small" data-focus={`t-down-${t.def.id}`} onClick={() => moveTile(i, 1)}>▼</div>
        </div>
      ))}

      <h2 class="section">O aplikaci</h2>
      <div class="muted">aTV 0.1.0 · {platform.name}</div>
      <img src="./credits/tmdb.svg" alt="TMDB" width="110" height="48" />
      <div class="muted">Filmová metadata a fotografie: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</div>
    </div>
  )
}
