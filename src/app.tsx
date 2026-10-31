import { Artists, ArtArtistDetail, Gallery } from './screens/Art'
import { Musicians, MusicianDetail } from './screens/Musicians'
import { AudioDetail, SourceSearch } from './screens/Audio'
import { useEffect, useState } from 'preact/hooks'
import { toAction, type Action } from '../shared/keys.ts'
import type { HubToTv } from '../shared/protocol.ts'
import { runIntent, sleepNow } from './actions'
import { Cursor, clickCursor, moveCursor, stepCursor } from './cursor'
import { activate, move } from './nav/focus'
import { Notices, Screensaver, Toast } from './overlays'
import { platform } from './runtime'
import { keyHandlers, nav, playerControl, stack, textHandlers, useStore, type StackEntry } from './state'
import { onHubMessage, reportState } from './services/hub'
import { settings } from './services/settings'
import { appearance } from './services/appearance'
import { Detail } from './screens/Detail'
import { Home, SleepBadge } from './screens/Home'
import { Actors, ActorDetail } from './screens/Actors'
import { Browser } from './screens/Browser'
import { Iptv } from './screens/Iptv'
import { CtShowScreen, Ivysilani } from './screens/Ivysilani'
import { Media } from './screens/Media'
import { MediaDetail } from './screens/MediaDetail'
import { KeyboardScreen } from './screens/KeyboardScreen'
import { Library } from './screens/Library'
import { Login } from './screens/Login'
import { Player } from './screens/Player'
import { Search } from './screens/Search'
import { Settings } from './screens/Settings'
import { AppearancePanel } from './screens/Appearance'

/** Screens whose arrows mean something else (seeking, a gallery) or that have their own pointer. */
const NO_MOUSE = new Set(['player', 'gallery', 'browser'])

let lastInput = Date.now()
let saverOn = false
let setSaver: (on: boolean) => void = () => {}

/** Every remote key, from the TV or the phone, goes through here. */
export function handleAction(action: Action): void {
  lastInput = Date.now()
  if (saverOn) {
    // The first key only wakes the screen.
    setSaver(false)
    return
  }
  const top = nav.top()
  if (keyHandlers.get(top.key)?.(action)) return
  // The virtual mouse everywhere: arrows move the cursor, at the screen's edge they scroll the content.
  const mouse = settings.get().virtualMouse === 'all' && !NO_MOUSE.has(top.type)
  if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
    if (!mouse || !stepCursor(action)) move(action)
  } else if (action === 'ok') {
    if (!mouse || !clickCursor()) activate()
  }
  else if (action === 'back') {
    if (stack.get().length > 1) nav.pop()
    else platform.exit()
  }
}

function onHub(msg: HubToTv): void {
  if (msg.t === 'key') handleAction(msg.action)
  else if (msg.t === 'pointer' || msg.t === 'click') {
    lastInput = Date.now()
    if (saverOn) return setSaver(false)
    if (msg.t === 'pointer') moveCursor(msg.dx, msg.dy)
    else if (!clickCursor()) handleAction('ok')
  }
  else if (msg.t === 'text') {
    lastInput = Date.now()
    const top = nav.top()
    const h = textHandlers.get(top.key)
    if (h) h(msg.text, !!msg.submit)
    else if (msg.submit && msg.text.trim()) nav.push({ type: 'search', query: msg.text })
  } else if (msg.t === 'intent') {
    lastInput = Date.now()
    setSaver(false)
    runIntent(msg.intent).catch(() => {})
  } else if (msg.t === 'sleep-fire') sleepNow()
  else if (msg.t === 'appearance') appearance.set({ appearance: msg.appearance, backgrounds: msg.backgrounds })
}

function ScreenView({ entry, top, under }: { entry: StackEntry; top: boolean; under: boolean }) {
  const k = entry.key
  let body
  switch (entry.type) {
    case 'home':
      body = <Home active={top} />
      break
    case 'library':
      body = <Library parentId={entry.parentId} title={entry.title} collectionType={entry.collectionType} />
      break
    case 'detail':
      body = <Detail itemId={entry.itemId} active={top} />
      break
    case 'player':
      body = <Player source={entry.source} screenKey={k} />
      break
    case 'search':
      body = <Search query={entry.query} screenKey={k} />
      break
    case 'iptv':
      body = <Iptv />
      break
    case 'ivysilani':
      body = <Ivysilani screenKey={k} query={entry.query} />
      break
    case 'ct-show':
      body = <CtShowScreen id={entry.id} title={entry.title} />
      break
    case 'settings':
      body = <Settings />
      break
    case 'appearance':
      body = <AppearancePanel screenKey={k} />
      break
    case 'browser':
      body = <Browser screenKey={k} url={entry.url} />
      break
    case 'artists':
      body = <Artists />
      break
    case 'art-artist':
      body = <ArtArtistDetail id={entry.id} />
      break
    case 'gallery':
      body = <Gallery artistId={entry.artistId} start={entry.start} screenKey={k} />
      break
    case 'musicians':
      body = <Musicians />
      break
    case 'musician':
      body = <MusicianDetail id={entry.id} />
      break
    case 'audio':
      body = <SourceSearch screenKey={k} kind="audio" indexer={entry.indexer} name={entry.name} query={entry.query} />
      break
    case 'source-search':
      body = <SourceSearch screenKey={k} kind="video" indexer={entry.indexer} name={entry.name} />
      break
    case 'audio-detail':
      body = <AudioDetail mediaId={entry.mediaId} title={entry.title} poster={entry.poster} />
      break
    case 'media':
      body = <Media />
      break
    case 'actors':
      body = <Actors />
      break
    case 'actor':
      body = <ActorDetail actor={entry.actor} />
      break
    case 'media-detail':
      body = <MediaDetail mediaKey={entry.mediaId} title={entry.title} poster={entry.poster} description={entry.description} />
      break
    case 'login':
      body = <Login />
      break
    case 'keyboard':
      body = <KeyboardScreen title={entry.title} value={entry.value} secret={entry.secret} onDone={entry.onDone} screenKey={k} />
      break
  }
  // Lower screens stay mounted (hidden) so Back returns to them as they were.
  return (
    <div class={`screen screen-${entry.type}${top ? ' top' : under ? ' under' : ' hidden'}`} data-screen={String(k)}>
      {body}
    </div>
  )
}

export function App() {
  const screens = useStore(stack)
  const s = useStore(settings)
  const [saver, setSaverState] = useState(false)
  saverOn = saver
  setSaver = setSaverState

  useEffect(() => {
    onHubMessage(onHub)
    const onKey = (e: KeyboardEvent) => {
      // Let the browser handle clipboard shortcuts, selection and ordinary field editing.
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const editable = e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]')
      if (editable && e.key !== 'Escape') { lastInput = Date.now(); return }
      const action = toAction(e)
      if (!action) return
      e.preventDefault()
      handleAction(action)
    }
    document.addEventListener('keydown', onKey)
    const onPaste = (e: ClipboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable="true"]')) return
      const top = nav.top()
      if (top.type !== 'search' && top.type !== 'keyboard' && top.type !== 'audio' && top.type !== 'source-search') return
      const handler = textHandlers.get(top.key)
      const text = e.clipboardData?.getData('text/plain')
      if (handler && text) { e.preventDefault(); lastInput = Date.now(); handler(text.slice(0, 10_000), false) }
    }
    document.addEventListener('paste', onPaste)
    const onMouse = () => {
      lastInput = Date.now()
    }
    document.addEventListener('mousemove', onMouse)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('mousemove', onMouse)
    }
  }, [])

  // The screensaver starts after the set idle time, but never over a playing video.
  useEffect(() => {
    if (!s.screensaverMinutes) return
    const t = window.setInterval(() => {
      const playing = playerControl.get()
      if (!saverOn && !playing && nav.top().type !== 'gallery' && Date.now() - lastInput > s.screensaverMinutes * 60_000) setSaverState(true)
    }, 15_000)
    return () => window.clearInterval(t)
  }, [s.screensaverMinutes])

  const top = screens[screens.length - 1]
  useEffect(() => {
    if (top.type !== 'player') reportState({ screen: top.type })
  }, [top.key])

  return (
    <>
      {screens.map((e, i) => (
        <ScreenView key={e.key} entry={e} top={e === top} under={top.type === 'appearance' && i === screens.length - 2} />
      ))}
      {top.type !== 'home' && top.type !== 'player' && top.type !== 'gallery' && (
        <div class="corner-badge">
          <SleepBadge />
        </div>
      )}
      {saver && <Screensaver />}
      <Cursor />
      <Notices />
      <Toast />
    </>
  )
}

