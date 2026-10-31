// Browser UI regression: isolated hub by default; ATV_BROWSER_TEST_HUB tests a deployed hub.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const dataDir = mkdtempSync(join(tmpdir(), 'atv-browser-ui-'))
const shots = join(dataDir, 'screenshots'); mkdirSync(shots)
const HUB = process.env.ATV_BROWSER_TEST_HUB ?? 'http://localhost:8093'
const events = []
let visits = 0
const fixture = createServer(async (req, res) => {
  if (req.url === '/event' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk
    events.push(JSON.parse(body)); res.end('ok'); return
  }
  if (req.url === '/empty') { res.setHeader('content-type', 'text/html'); res.end(''); return }
  visits++
  const second = req.url === '/second'
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="cs"><title>${second ? 'Druhá stránka' : 'Test prohlížeče'}</title>
  <style>body{margin:0;background:#eaf0f5;color:#15283c;font:24px sans-serif}header{padding:32px 64px;background:#163b58;color:white}main{padding:20px 64px}input{position:absolute;left:500px;top:270px;width:280px;height:50px;font:24px sans-serif}a{display:inline-block;margin:20px;padding:20px;background:#c3dbea}footer{position:absolute;top:1400px}</style>
  <header>aTV · Test prohlížeče</header><main><h1>${second ? 'Druhá stránka' : 'Prohlížeč uvnitř aTV'}</h1>
  <p>Ověření obrazu, ovladače, psaní a historie.</p><input aria-label="Text" oninput="fetch('/event',{method:'POST',body:JSON.stringify({text:this.value})})">
  <a style="position:absolute;left:64px;top:370px" target="_blank" href="/second">Další stránka →</a>
  <footer>Konec stránky</footer></main><script>addEventListener('scroll',()=>fetch('/event',{method:'POST',body:JSON.stringify({scroll:scrollY})}));</script>`)
})
await new Promise(resolve => fixture.listen(0, '0.0.0.0', resolve))
const fixtureHost = process.env.ATV_BROWSER_TEST_HUB ? 'host.docker.internal' : '127.0.0.1'
const fixtureUrl = `http://${fixtureHost}:${fixture.address().port}/first`
let hub
if (!process.env.ATV_BROWSER_TEST_HUB) {
  hub = spawn(process.execPath, ['hub/index.ts'], {env:{...process.env,HUB_PORT:'8093',ATV_DATA:dataDir,ATV_DIST:'dist',SAMSUNG_HOST:'',JACKETT_URL:'',JACKETT_API_KEY:''},stdio:'ignore'})
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let failures = 0
function check(name, ok) { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failures++ }
for (let i=0;i<50;i++) { try { if ((await fetch(`${HUB}/api/config`)).ok) break } catch {} await sleep(200) }
process.on('exit',()=>{hub?.kill();fixture.close()})
// --- Chrome over the DevTools protocol ---------------------------------------
const chromeProfile = mkdtempSync(join(tmpdir(), 'atv-browser-viewer-'))
let port
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${chromeProfile}`,
  '--window-size=1920,1080', '--autoplay-policy=no-user-gesture-required', '--no-first-run', 'about:blank',
], { stdio: 'ignore' })
process.on('exit', () => chrome.kill())

let targets
for (let i = 0; i < 50; i++) {
  try {
    port = Number(readFileSync(join(chromeProfile, 'DevToolsActivePort'), 'utf8').split('\n')[0])
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


let phone
try {
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', {width:1920,height:1080,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate', {url:`${HUB}/`})
  if (!await waitFor(`!!document.querySelector('[data-focus="tile-browser"]')`)) throw new Error('Home did not render')
  await clickFocus('tile-settings')
  if (!await waitFor(`!!document.querySelector('.screen.top .big-code')`)) throw new Error('Pairing not ready')
  const code = await evaluate(`document.querySelector('.screen.top .big-code').textContent`)
  const {token} = await (await fetch(`${HUB}/api/pair`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})})).json()
  phone = new WebSocket(`${HUB.replace(/^http/,'ws')}/ws`)
  await new Promise(resolve=>phone.once('open',resolve))
  phone.send(JSON.stringify({t:'hello',role:'remote',token}))
  await sleep(300)
  await press('back')
  await clickFocus('tile-browser')
  check('browser toolbar opens inside aTV',await waitFor(`!!document.querySelector('.screen.top [data-focus="b-address"]')`))
  await clickFocus('b-address')
  if (!await waitFor(`!!document.querySelector('.screen.top .keyboard-screen')`)) throw new Error('Address keyboard did not open')
  await sleep(250)
  phone.send(JSON.stringify({t:'text',text:fixtureUrl,submit:true}))
  check('address opens in embedded browser',await waitFor(`document.querySelector('.screen.top .browser-url')?.textContent === ${JSON.stringify(fixtureUrl)}`,20000))
  check('page image renders',await waitFor(`(()=>{const i=document.querySelector('.screen.top .browser-frame');return i?.naturalWidth===1280 && i.complete})()`,20000))
  await sleep(500)
  await shot('browser-page')
  const bounds = await evaluate(`(()=>{const r=document.querySelector('.browser-frame').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`)
  check('frame is 16:9 and fits the screen',Math.abs(bounds.w/bounds.h-16/9)<0.02 && bounds.y+bounds.h<=1080)
  // Default remote pointer is over the input at (640, 288) on the remote page.
  await press('ok')
  phone.send(JSON.stringify({t:'text',text:'Příliš žluťoučký'}))
  for(let i=0;i<30&&!events.some(e=>e.text==='Příliš žluťoučký');i++) await sleep(100)
  check('remote OK clicks and phone types Czech text',events.some(e=>e.text==='Příliš žluťoučký'))
  phone.send(JSON.stringify({t:'text',text:'Příliš žluťoučká'}))
  for(let i=0;i<30&&!events.some(e=>e.text==='Příliš žluťoučká');i++) await sleep(100)
  check('phone text editing sends backspace and replacement',events.some(e=>e.text==='Příliš žluťoučká'))
  const before = await evaluate(`document.querySelector('.browser-pointer').style.left`)
  await press('right')
  check('arrows move the browser pointer',await evaluate(`document.querySelector('.browser-pointer').style.left`)!==before)
  // Click the link using the same image coordinates a mouse or trackpad uses.
  const x=bounds.x+bounds.w*200/1280,y=bounds.y+bounds.h*405/720
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})
  check('clicking image follows links',await waitFor(`document.querySelector('.browser-url')?.textContent.endsWith('/second')`))
  await press('back')
  check('remote Back navigates page history',await waitFor(`document.querySelector('.browser-url')?.textContent.endsWith('/first')`))
  await clickFocus('b-forward')
  check('toolbar Forward restores page',await waitFor(`document.querySelector('.browser-url')?.textContent.endsWith('/second')`))
  const previousVisits = visits
  await clickFocus('b-reload')
  for(let i=0;i<50 && visits<=previousVisits;i++) await sleep(100)
  check('toolbar Reload reloads the remote page',visits>previousVisits)
  const scrollX=bounds.x+bounds.w/2,scrollY=bounds.y+bounds.h/2
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:scrollX,y:scrollY,deltaX:0,deltaY:400})
  for(let i=0;i<30&&!events.some(e=>e.scroll>0);i++) await sleep(100)
  check('mouse wheel scrolls the remote page',events.some(e=>e.scroll>0))
  await clickFocus('b-bookmarks')
  check('bookmarks panel opens',await waitFor(`!!document.querySelector('.browser-bookmarks [data-focus="bm-add"]')`))
  await clickFocus('bm-add')
  check('bookmark is saved in aTV settings',await waitFor(`JSON.parse(localStorage.getItem('atv.settings')).bookmarks.some(b=>b.url.endsWith('/second'))`))
  await press('back')
  await shot('browser-final')
  await clickFocus('b-address')
  await waitFor(`!!document.querySelector('.screen.top .keyboard-screen')`)
  await sleep(250)
  phone.send(JSON.stringify({t:'text',text:fixtureUrl.replace('/first','/empty'),submit:true}))
  check('empty website shows a useful error',await waitFor(`document.querySelector('.browser-error')?.textContent.includes('prázdnou stránku')`))
  await shot('browser-empty')
  await clickFocus('b-address')
  await waitFor(`!!document.querySelector('.screen.top .keyboard-screen')`)
  await sleep(250)
  phone.send(JSON.stringify({t:'text',text:fixtureUrl,submit:true}))
  check('opening another website clears the previous error',await waitFor(`document.querySelector('.browser-url')?.textContent.endsWith('/first') && !document.querySelector('.browser-error')`))
  console.log(`Screenshots: ${shots}`)
} finally {
  phone?.close(); cdp.close(); chrome.kill(); hub?.kill(); fixture.close()
}
if(failures) throw new Error(`${failures} browser checks failed`)
console.log('All browser checks passed')
