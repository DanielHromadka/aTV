// End-to-end check against a running Jellyfin (npm run up && npm run seed) and the built app
// (npm run build): starts its own hub on a spare port with an empty data directory, so it never
// reaches a real TV or the aTV windows connected to your hub. Drives the TV app in headless Chrome
// with remote keys, logs in with Quick Connect, plays a direct-play and a transcoded video, pairs a
// phone, sends voice-style commands and moves the cursor from the trackpad.
//   node scripts/smoke.mjs [screenshot dir]
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const JF = process.env.JELLYFIN_URL ?? 'http://localhost:8096'
const HUB_PORT = 8091
const HUB = `http://localhost:${HUB_PORT}`
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const shots = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'atv-smoke-'))
mkdirSync(shots, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures++
}

// --- A private hub: no Samsung, test playlist, fresh pairing and notify tokens -----
const hubData = mkdtempSync(join(tmpdir(), 'atv-hub-'))
// Sintel (Blender Foundation, CC BY): a torrent with a web seed and subtitles in several languages.
writeFileSync(join(hubData, 'catalog.json'), JSON.stringify([
  { id: '5a1e7e15a1e7', title: 'Sintel', year: 2010, source: 'https://webtorrent.io/torrents/sintel.torrent', languages: [], subtitles: [], addedAt: Date.now() },
]))
writeFileSync(join(hubData, 'iptv.m3u'), '#EXTM3U\n#EXTINF:-1 group-title="Testovací",Mux test\nhttps://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8\n')
const hub = spawn(process.execPath, ['hub/index.ts'], {
  env: { ...process.env, HUB_PORT: String(HUB_PORT), ATV_DATA: hubData, ATV_DIST: 'dist', JELLYFIN_URL: JF, IPTV_PLAYLIST: 'iptv.m3u', SAMSUNG_HOST: '', HUB_PUBLIC_URL: HUB },
  stdio: 'ignore',
})
process.on('exit', () => hub.kill())
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${HUB}/api/health`)).ok) break
  } catch {}
  await sleep(200)
}
const notifyToken = JSON.parse(readFileSync(join(hubData, 'state.json'), 'utf8')).notifyToken

// --- Chrome over the DevTools protocol ---------------------------------------
const port = 9333
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'atv-chrome-'))}`,
  '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })
process.on('exit', () => chrome.kill())

let targets
for (let i = 0; i < 50; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
    if (targets.some((t) => t.type === 'page')) break
  } catch {}
  await sleep(200)
}
const page = targets.find((t) => t.type === 'page')
const cdp = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => cdp.once('open', r))
let seq = 0
const pending = new Map()
cdp.on('message', (d) => {
  const m = JSON.parse(String(d))
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    cdp.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed')
  return r.result.value
}
const KEYS = { right: ['ArrowRight', 39], left: ['ArrowLeft', 37], up: ['ArrowUp', 38], down: ['ArrowDown', 40], ok: ['Enter', 13], back: ['Escape', 27] }
async function press(name, times = 1) {
  const [key, code] = KEYS[name]
  for (let i = 0; i < times; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
    await sleep(150)
  }
}
const focused = () => evaluate(`document.querySelector('.screen.top .focused')?.dataset.focus ?? null`)
const topScreen = () => evaluate(`(() => { const t = document.querySelector('.screen.top'); return t && t.firstElementChild ? t.firstElementChild.className : '' })()`)
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(shots, `${name}.png`), Buffer.from(data, 'base64'))
}
async function waitFor(expr, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await evaluate(expr).catch(() => false)) return true
    await sleep(300)
  }
  return false
}
const clickFocus = (id) => evaluate(`document.querySelector('.screen.top [data-focus="${id}"]').click()`)

// Start from a clean watch history, so resume rows and buttons are predictable.
{
  const h = 'MediaBrowser Client="smoke", Device="smoke", DeviceId="smoke", Version="1"'
  const a = await (await fetch(`${JF}/Users/AuthenticateByName`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: h }, body: JSON.stringify({ Username: 'atv', Pw: 'atv' }) })).json()
  const auth = { Authorization: `${h}, Token="${a.AccessToken}"` }
  const items = await (await fetch(`${JF}/Items?userId=${a.User.Id}&recursive=true&includeItemTypes=Movie,Episode`, { headers: auth })).json()
  for (const i of items.Items) await fetch(`${JF}/UserPlayedItems/${i.Id}?userId=${a.User.Id}`, { method: 'DELETE', headers: auth })
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })

// --- Home and remote navigation ------------------------------------------------
await send('Page.navigate', { url: `${HUB}/` })
check('home renders the app tiles', await waitFor(`document.querySelectorAll('.tile').length >= 8`))
check('connected to the hub', await waitFor(`document.querySelector('.screen.top') && window.localStorage !== undefined && !!document.querySelector('.meta')`))
await press('down')
const first = await focused()
await press('right', 2)
const moved = await focused()
check('arrow keys move focus along the row', first !== moved, `${first} → ${moved}`)
await shot('01-home')

// --- Browser Back and Forward walk the screens -------------------------------------
await clickFocus('tile-settings')
check('a screen has its own address', await waitFor(`location.hash === '#/settings'`), await evaluate('location.hash'))
await evaluate('history.back()')
check('browser Back returns to the previous screen', await waitFor(`document.querySelectorAll('.screen').length === 1 && location.hash === '#/'`))
await evaluate('history.forward()')
check('browser Forward brings the screen back', await waitFor(`document.querySelectorAll('.screen').length === 2 && !!document.querySelector('.screen.top [data-focus="saver"]')`))
await press('back')
check('remote Back goes through the same history', await waitFor(`document.querySelectorAll('.screen').length === 1 && location.hash === '#/'`))

// --- Jellyfin login with Quick Connect -----------------------------------------
await clickFocus('hint-login')
const loginOpen = await waitFor(`!!document.querySelector('.screen.top [data-focus="quick"]')`)
if (!loginOpen) await shot('02-login-failed')
check('login screen opens', loginOpen, await evaluate(`document.querySelector('.screen.top')?.innerText.slice(0, 200)`))
await clickFocus('quick')
check('Quick Connect shows a code', await waitFor(`!!document.querySelector('.screen.top .big-code')`))
const code = await evaluate(`document.querySelector('.screen.top .big-code').textContent`)
await shot('02-quick-connect')
const auth = await (await fetch(`${JF}/Users/AuthenticateByName`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'MediaBrowser Client="smoke", Device="smoke", DeviceId="smoke", Version="1"' },
  body: JSON.stringify({ Username: 'atv', Pw: 'atv' }),
})).json()
const approve = await fetch(`${JF}/QuickConnect/Authorize?code=${code}&userId=${auth.User.Id}`, {
  method: 'POST',
  headers: { Authorization: `MediaBrowser Client="smoke", Device="smoke", DeviceId="smoke", Version="1", Token="${auth.AccessToken}"` },
})
check('Quick Connect code approved on the server', approve.ok, `HTTP ${approve.status}`)
check('TV logs in and returns home', await waitFor(`!document.querySelector('[data-focus="hint-login"]') && document.querySelectorAll('.screen').length === 1`, 20000))
check('home shows Jellyfin rows', await waitFor(`[...document.querySelectorAll('.row-title')].some(h => h.textContent === 'Nově přidané')`))
check('home shows IPTV channels', await waitFor(`[...document.querySelectorAll('.row-title')].some(h => h.textContent === 'Televize')`))
await shot('03-home-jellyfin')

// --- Play a direct-play MP4, then a transcoded MKV -------------------------------
const clickCard = async (text) => {
  await waitFor(`[...document.querySelectorAll('.screen.top .card')].some(c => c.textContent.includes(${JSON.stringify(text)}))`)
  await evaluate(`[...document.querySelectorAll('.screen.top .card')].find(c => c.textContent.includes(${JSON.stringify(text)})).click()`)
}
async function goHome() {
  for (let i = 0; i < 8 && (await evaluate(`document.querySelectorAll('.screen').length`)) > 1; i++) await press('back')
}
// Through the library (watched titles drop out of "Nově přidané").
async function playMovie(name) {
  await clickFocus('tile-library')
  await clickCard('Filmy')
  await clickCard(name)
  await waitFor(`!!document.querySelector('.screen.top [data-focus="play"]')`)
  await clickFocus('play')
  const playing = await waitFor(`(() => { const v = document.querySelector('.screen.top video'); return v && v.currentTime > 1 })()`, 30000)
  const err = await evaluate(`document.querySelector('.player-error')?.textContent ?? ''`)
  return { playing, err }
}
let r = await playMovie('Testovací film')
check('MP4 plays directly', r.playing, r.err)
await press('right', 2)
await sleep(1500)
await shot('04-player')
await goHome()
r = await playMovie('Druhý test')
check('MKV/AC3 plays through the HLS transcode', r.playing, r.err)
await goHome()
check('Back returns home', await waitFor(`document.querySelectorAll('.screen').length === 1`))
check('“Pokračovat ve sledování” appears after watching', await waitFor(`[...document.querySelectorAll('.row-title')].some(h => h.textContent === 'Pokračovat ve sledování')`, 10000))
await shot('05-home-resume')

// --- Phone remote: pair, keys, text and commands -------------------------------
await clickFocus('tile-settings')
await waitFor(`!!document.querySelector('.screen.top .big-code')`)
const pairCode = await evaluate(`document.querySelector('.screen.top .big-code').textContent`)
await shot('06-settings')
const pair = await fetch(`${HUB}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairCode }) })
const { token } = await pair.json()
check('phone pairs with the code from the TV', pair.ok && !!token)
const phone = new WebSocket(`${HUB.replace(/^http/, 'ws')}/ws`)
await new Promise((res) => phone.once('open', res))
const phoneMsgs = []
phone.on('message', (d) => phoneMsgs.push(JSON.parse(String(d))))
phone.send(JSON.stringify({ t: 'hello', role: 'remote', token }))
await sleep(500)
check('phone sees the TV', phoneMsgs.some((m) => m.t === 'status' && m.tv), JSON.stringify(phoneMsgs.at(-1)?.tv))
phone.send(JSON.stringify({ t: 'key', action: 'back' }))
check('phone Back key reaches the TV', await waitFor(`document.querySelectorAll('.screen').length === 1`))

const results = () => phoneMsgs.filter((x) => x.t === 'result')
const command = async (text) => {
  const before = results().length
  phone.send(JSON.stringify({ t: 'command', text }))
  const end = Date.now() + 8000
  while (Date.now() < end) {
    if (results().length > before) return results()[before]
    await sleep(100)
  }
  return null
}
let res = await command('najdi druhý')
check('“najdi …” opens search with results', res?.ok && (await waitFor(`[...document.querySelectorAll('.screen.top .card-title')].some(t => t.textContent.includes('Druhý test'))`)), res?.message)
await shot('07-search')
phone.send(JSON.stringify({ t: 'text', text: 'testovací' }))
check('typing on the phone fills the search field', await waitFor(`(() => { const f = document.querySelector('.screen.top .search-field'); return !!f && (f.value ?? f.textContent).includes('testovací') })()`))
res = await command('pusť testovací film')
check('“pusť …” plays from the library', res?.ok && (await waitFor(`(() => { const v = document.querySelector('.screen.top video'); return v && v.currentTime > 0.5 })()`, 20000)), res?.message)
await sleep(800)
check('phone shows what is playing', phoneMsgs.some((m) => m.t === 'status' && m.tv?.playing), JSON.stringify(phoneMsgs.findLast((m) => m.t === 'status')?.tv))
res = await command('pauza')
check('“pauza” pauses', res?.ok && (await waitFor(`document.querySelector('.screen.top video')?.paused === true`)))
res = await command('domů')
check('“domů” goes home', res?.ok && (await waitFor(`document.querySelectorAll('.screen').length === 1`)))
res = await command('otevři prohlížeč')
check('“otevři prohlížeč” opens the browser screen', res?.ok && (await waitFor(`!!document.querySelector('.screen.top [data-focus="b-address"]')`)))
await shot('08-browser')
res = await command('vypni za 30 minut')
check('sleep timer is set and shown', res?.ok && (await waitFor(`!!document.querySelector('.sleep-badge')`)), res?.message)
await command('zruš časovač')
res = await command('udělej mi kafe')
check('unknown commands are refused politely', res && !res.ok, res?.message)

// --- Notification ----------------------------------------------------------------
await fetch(`${HUB}/api/notify`, { method: 'POST', headers: { authorization: `Bearer ${notifyToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Test oznámení', text: 'Odesláno automatickým testem aTV' }) })
check('notification appears on the TV', await waitFor(`!!document.querySelector('.notice')`))
await shot('09-notification')

// --- Trackpad cursor (aTV draws its own where the TV has none) --------------------
await command('domů')
await waitFor(`document.querySelectorAll('.screen').length === 1`)
// A tile of aTV's own (apps would open a new tab) that is fully on screen.
const target = await evaluate(`(() => {
  const external = ['tile-telly', 'tile-disney', 'tile-netflix', 'tile-youtube']
  for (const el of document.querySelectorAll('[data-focus^="tile-"]')) {
    if (external.includes(el.dataset.focus)) continue
    const r = el.getBoundingClientRect()
    if (r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight) return { id: el.dataset.focus, x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  return null
})()`)
let cx = 960
let cy = 540
while (Math.abs(target.x - cx) > 1 || Math.abs(target.y - cy) > 1) {
  const dx = Math.max(-200, Math.min(200, target.x - cx))
  const dy = Math.max(-200, Math.min(200, target.y - cy))
  phone.send(JSON.stringify({ t: 'pointer', dx, dy }))
  cx += dx
  cy += dy
  await sleep(30)
}
check('trackpad moves a cursor that focuses what it hovers', await waitFor(`document.querySelector('.cursor.show') && document.querySelector('.focused')?.dataset.focus === ${JSON.stringify(target.id)}`), target.id)
await shot('12-cursor')
phone.send(JSON.stringify({ t: 'click' }))
check('trackpad tap clicks under the cursor', await waitFor(`document.querySelectorAll('.screen').length === 2`))

// --- Torrent films: own catalog with subtitles, Internet Archive search --------------
await goHome()
await clickFocus('tile-films')
await clickCard('Sintel')
check('torrent film opens with its subtitles', await waitFor(`[...document.querySelectorAll('.screen.top .btn')].some(b => b.textContent.includes('Němčina'))`, 90000))
await evaluate(`[...document.querySelectorAll('.screen.top .btn')].find(b => b.textContent.includes('Němčina')).click()`)
await shot('13-film-detail')
await clickFocus('play')
check('torrent film streams while downloading', await waitFor(`(() => { const v = document.querySelector('.screen.top video'); return v && v.currentTime > 1 })()`, 60000))
await sleep(500)
await evaluate(`(() => { const v = document.querySelector('.screen.top video'); v.currentTime = 50 })()`)
check('subtitles are showing', await waitFor(`(() => { const t = document.querySelector('.screen.top video').textTracks[0]; return t && t.mode === 'showing' && t.cues && t.cues.length > 10 })()`, 20000))
await sleep(2500)
await shot('14-film-subtitles')
await goHome()
await command('najdi nosferatu')
check('search finds Internet Archive films ranked by relevance', await waitFor(`[...document.querySelectorAll('.screen.top .row-title')].some(h => h.textContent.includes('Filmy'))`, 30000))
await shot('15-film-search')
await goHome()

// --- aTV's own browser (Chrome on the hub) ---------------------------------------------
res = await command('otevři example.com')
check('“otevři …” opens the page in aTV’s browser', res?.ok && (await waitFor(`document.querySelector('.screen.top .browser-title')?.textContent === 'Example Domain'`, 30000)), res?.message)
check('the page picture arrives from the hub', await waitFor(`(() => { const i = document.querySelector('.screen.top .browser-frame'); return i && i.naturalWidth === 1280 })()`, 15000))
const before = await evaluate(`document.querySelector('.browser-pointer')?.style.left`)
await press('right', 3)
check('arrows move the page pointer', (await evaluate(`document.querySelector('.browser-pointer')?.style.left`)) !== before)
await shot('16-browser')
await press('back')
check('Back on the first page returns to the bar', await waitFor(`!document.querySelector('.browser-view.active')`))
await goHome()

// --- The phone remote page itself ------------------------------------------------
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1100, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: `${HUB}/remote.html` })
await waitFor(`!!document.querySelector('.code')`)
await evaluate(`localStorage.setItem('atv.remote.token', ${JSON.stringify(token)}); location.reload()`)
check('phone remote page connects', await waitFor(`document.querySelector('.status')?.textContent.includes('Televize') || document.querySelector('.status')?.textContent.includes('aTV')`))
await shot('10-phone-remote')
await evaluate(`[...document.querySelectorAll('.switch button')].find(b => b.textContent === 'Trackpad').click()`)
check('trackpad mode can be switched on', await waitFor(`!!document.querySelector('.trackpad')`))
await shot('11-phone-trackpad')

phone.close()
cdp.close()
console.log(`\nScreenshots: ${shots}`)
console.log(failures ? `${failures} check(s) failed` : 'All checks passed')
process.exit(failures ? 1 : 0)
