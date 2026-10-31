import { useEffect, useReducer } from 'preact/hooks'
import type { Action } from '../shared/keys.ts'
import type { PublicConfig } from '../shared/protocol.ts'
import type { Actor } from '../shared/actors.ts'

type Listener = () => void

export interface Store<T> {
  get(): T
  set(next: T | ((prev: T) => T)): void
  subscribe(l: Listener): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<Listener>()
  return {
    get: () => value,
    set(next) {
      value = typeof next === 'function' ? (next as (prev: T) => T)(value) : next
      listeners.forEach((l) => l())
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

export function useStore<T>(store: Store<T>): T {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => store.subscribe(() => force(0)), [store])
  return store.get()
}

// --- Screens -------------------------------------------------------------------

import type { PlayerSource } from '../shared/playback.ts'
export type { PlayerSource } from '../shared/playback.ts'

export type ScreenSpec =
  | { type: 'home' }
  | { type: 'library'; parentId?: string; title?: string; collectionType?: string }
  | { type: 'detail'; itemId: string }
  | { type: 'player'; source: PlayerSource }
  | { type: 'search'; query?: string }
  | { type: 'iptv' }
  | { type: 'ivysilani'; query?: string }
  | { type: 'ct-show'; id: string; title: string }
  | { type: 'settings' }
  /** Drawn over the screen below it, so changes show live behind the panel. */
  | { type: 'appearance' }
  | { type: 'browser'; url?: string }
  | { type: 'media' }
  | { type: 'audio'; indexer?: string; name?: string; query?: string }
  | { type: 'artists' }
  | { type: 'art-artist'; id: string }
  | { type: 'gallery'; artistId: string; start: number }
  | { type: 'musicians' }
  | { type: 'musician'; id: string }
  | { type: 'source-search'; indexer: string; name: string }
  | { type: 'audio-detail'; mediaId: string; title: string; poster?: string }
  | { type: 'actors' }
  | { type: 'actor'; actor: Actor }
  | { type: 'media-detail'; mediaId: string; title: string; poster?: string; description?: string }
  | { type: 'login' }
  | { type: 'keyboard'; title: string; value: string; secret?: boolean; onDone: (value: string) => void }

export type StackEntry = ScreenSpec & { key: number }

let nextKey = 1
export const stack = createStore<StackEntry[]>([{ type: 'home', key: 0 }])

/** The URL fragment for a screen, so the address bar shows where you are ("#/media-detail/ia%3Anosferatu"). */
function hashFor(e: ScreenSpec): string {
  switch (e.type) {
    case 'home':
      return '#/'
    case 'detail':
      return `#/detail/${encodeURIComponent(e.itemId)}`
    case 'media-detail':
      return `#/media-detail/${encodeURIComponent(e.mediaId)}`
    case 'library':
      return e.parentId ? `#/library/${encodeURIComponent(e.parentId)}` : '#/library'
    default:
      return `#/${e.type}`
  }
}

/**
 * The browser's history mirrors the screen stack: every screen is a history entry, so the browser's
 * Back and Forward walk the screens, and the remote's Back goes through history too. Screens left
 * with Back are kept, so Forward brings them back as they were (searches, choices, scroll).
 */
let forward: StackEntry[] = []
const historyDepth = (): number => (history.state && typeof history.state.atvDepth === 'number' ? history.state.atvDepth : 0)

// history.back()/go() answer later with a popstate. The stack changes right away, and history
// writes that come meanwhile (Home then open a screen, as voice commands do) wait for that answer.
let ownPops = 0
let queued: (() => void)[] = []
function whenSettled(write: () => void): void {
  if (ownPops) queued.push(write)
  else write()
}
function goBack(steps: number, s: StackEntry[]): void {
  forward = [...s.slice(s.length - steps), ...forward]
  stack.set(s.slice(0, s.length - steps))
  if (historyDepth() === s.length && !ownPops) {
    ownPops++
    history.go(-steps)
  }
}

export function installHistory(): void {
  history.replaceState({ atvDepth: 1 }, '', hashFor(stack.get()[0]))
  window.addEventListener('popstate', (e) => {
    if (ownPops) {
      ownPops--
      const writes = queued
      queued = []
      writes.forEach((w) => w())
      return
    }
    // The browser's own Back or Forward.
    const target = e.state && typeof e.state.atvDepth === 'number' ? e.state.atvDepth : 1
    const s = stack.get()
    if (target < s.length) {
      forward = [...s.slice(target), ...forward]
      stack.set(s.slice(0, target))
    } else if (target > s.length) {
      // After a reload the kept screens are gone; Forward then stops where it is.
      const restore = forward.slice(0, target - s.length)
      forward = forward.slice(restore.length)
      if (restore.length) stack.set([...s, ...restore])
    }
  })
}

export const nav = {
  push(spec: ScreenSpec) {
    const entry = { ...spec, key: nextKey++ }
    forward = []
    stack.set((s) => [...s, entry])
    const depth = stack.get().length
    whenSettled(() => history.pushState({ atvDepth: depth }, '', hashFor(entry)))
  },
  pop() {
    const s = stack.get()
    if (s.length > 1) goBack(1, s)
  },
  /** Swaps the top screen, e.g. the player for the next episode. */
  replace(spec: ScreenSpec) {
    const entry = { ...spec, key: nextKey++ }
    stack.set((s) => [...s.slice(0, -1), entry])
    const depth = stack.get().length
    whenSettled(() => history.replaceState({ atvDepth: depth }, '', hashFor(entry)))
  },
  home() {
    const s = stack.get()
    if (s.length > 1) goBack(s.length - 1, s)
  },
  top(): StackEntry {
    const s = stack.get()
    return s[s.length - 1]
  },
}

/** Per-screen handlers; the top screen sees remote keys and phone text first. */
export const keyHandlers = new Map<number, (action: Action) => boolean>()
export const textHandlers = new Map<number, (text: string, submit: boolean) => void>()

export function useScreenKeys(screenKey: number, handler: (action: Action) => boolean): void {
  useEffect(() => {
    keyHandlers.set(screenKey, handler)
    return () => {
      keyHandlers.delete(screenKey)
    }
  })
}

export function useScreenText(screenKey: number, handler: (text: string, submit: boolean) => void): void {
  useEffect(() => {
    textHandlers.set(screenKey, handler)
    return () => {
      textHandlers.delete(screenKey)
    }
  })
}

// --- Shared state ----------------------------------------------------------------

export const config = createStore<PublicConfig | null>(null)

export const hubStatus = createStore<{ connected: boolean; pairing: { code: string; url: string } | null; sleepEndsAt: number | null }>({
  connected: false,
  pairing: null,
  sleepEndsAt: null,
})

export const weather = createStore<{ temp: number; code: number } | null>(null)

export interface Notice {
  id: number
  title: string
  text?: string
  image?: string
}
export const notices = createStore<Notice[]>([])
let noticeId = 1
export function notify(n: Omit<Notice, 'id'>, seconds = 10): void {
  const id = noticeId++
  notices.set((list) => [...list, { ...n, id }].slice(-3))
  setTimeout(() => notices.set((list) => list.filter((x) => x.id !== id)), seconds * 1000)
}

export const toastStore = createStore<{ id: number; text: string } | null>(null)
let toastId = 1
export function toast(text: string): void {
  const id = toastId++
  toastStore.set({ id, text })
  setTimeout(() => toastStore.set((t) => (t && t.id === id ? null : t)), 3500)
}

/** The playing player's controls, for voice commands and the sleep timer. */
export const playerControl = createStore<{ pause(): void; resume(): void; stop(): void; playing: boolean } | null>(null)
