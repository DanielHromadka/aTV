import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { completeWord, wordSuggestions } from '../shared/keyboard.ts'
import { weatherText } from '../shared/context.ts'
import { createStore, useStore, weather } from './state'
import { platform } from './runtime'

/**
 * Where the on-screen keyboard types: characters counted from the end of the text, so text added
 * from the end (the phone, suggestions) keeps the caret in place. Only one keyboard shows at a time.
 */
export const caretFromEnd = createStore(0)
/** Bumped by on-screen keys, so only they move the native field's caret (never the user's own selection). */
const caretKeys = createStore(0)
export const KEY_LEFT = '\u2190'
export const KEY_RIGHT = '\u2192'

/** Native browser editing supports selection, clipboard shortcuts and the context menu. */
export function TextField({ value, onChange, label, placeholder, secret, wide, onSubmit }: {
  value: string; onChange: (value: string) => void; label: string; placeholder?: string; secret?: boolean; wide?: boolean; onSubmit?: () => void
}) {
  const back = Math.min(useStore(caretFromEnd), value.length)
  const keyPresses = useStore(caretKeys)
  const input = useRef<HTMLInputElement>(null)
  // The on-screen keyboard's keys move the real caret of the native field too.
  useEffect(() => {
    const el = input.current
    if (!el || !keyPresses) return
    const pos = value.length - back
    if (el.selectionStart !== pos || el.selectionEnd !== pos) el.setSelectionRange(pos, pos)
  }, [keyPresses])
  const syncCaret = (el: HTMLInputElement) => caretFromEnd.set(el.value.length - (el.selectionEnd ?? el.value.length))
  if (platform.id === 'browser') return <input ref={input} class={`search-field native-text${wide ? ' wide' : ''}`} aria-label={label}
    {...(secret ? { type: 'password' as const } : { type: 'text' as const })} value={value} placeholder={placeholder} maxLength={10_000}
    autoComplete="off" spellcheck={false} onInput={(e) => { onChange(e.currentTarget.value); syncCaret(e.currentTarget) }}
    onKeyUp={(e) => syncCaret(e.currentTarget)} onClick={(e) => syncCaret(e.currentTarget)}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit?.() } }} />
  const shown = secret ? '•'.repeat(value.length) : value
  const pos = shown.length - back
  return <div class={`search-field${wide ? ' wide' : ''}`}>
    {value ? shown.slice(0, pos) : <span class="placeholder">{placeholder}</span>}<span class="caret" />{value ? shown.slice(pos) : null}
  </div>
}

/** A horizontally scrolling row with a heading. */
export function Row({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="row">
      <h2 class="row-title">{title}</h2>
      <div class="row-items" data-scroll="x">
        <div class="row-track">{children}</div>
      </div>
    </section>
  )
}

interface CardProps {
  id: string
  title: string
  subtitle?: string
  image?: string
  /** 0–1, drawn as a bar along the bottom. */
  progress?: number
  landscape?: boolean
  /** Shown when there is no image. */
  fallback?: string
  onClick: () => void
}

export function Card({ id, title, subtitle, image, progress, landscape, fallback, onClick }: CardProps) {
  const [failed, setFailed] = useState(false)
  return (
    <div class={`card ${landscape ? 'card-wide' : 'card-tall'}`} data-focus={id} onClick={onClick}>
      <div class="card-image">
        {image && !failed ? (
          <img src={image} alt="" onError={() => setFailed(true)} />
        ) : (
          <div class="card-fallback">{fallback ?? title.slice(0, 1)}</div>
        )}
        {progress !== undefined && progress > 0 && (
          <div class="card-progress">
            <div style={{ width: `${Math.min(progress, 1) * 100}%` }} />
          </div>
        )}
      </div>
      <div class="card-title">{title}</div>
      {subtitle && <div class="card-subtitle">{subtitle}</div>}
    </div>
  )
}

export function Button({ id, label, onClick, autofocus, primary }: { id: string; label: string; onClick: () => void; autofocus?: boolean; primary?: boolean }) {
  return (
    <div class={`btn${primary ? ' btn-primary' : ''}`} data-focus={id} data-autofocus={autofocus ? '' : undefined} onClick={onClick}>
      {label}
    </div>
  )
}

export function Spinner({ label = 'Načítám…' }: { label?: string }) {
  return (
    <div class="spinner">
      <div class="spinner-dot" />
      {label}
    </div>
  )
}

export function Message({ children }: { children: ComponentChildren }) {
  return <div class="message">{children}</div>
}

export function useClock(): Date {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(t)
  }, [])
  return now
}

export function Clock({ big }: { big?: boolean }) {
  const now = useClock()
  return <time class={big ? 'clock clock-big' : 'clock'}>{`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`}</time>
}

export function Weather() {
  const w = useStore(weather)
  if (!w) return null
  const { text, icon } = weatherText(w.code)
  return (
    <span class="weather" title={text}>
      <span class="weather-icon">{icon}</span>
      {Math.round(w.temp)}°
    </span>
  )
}

const LETTERS = ['qwertzuiop', 'asdfghjkl', 'yxcvbnm']
const SYMBOLS = ['1234567890', '@._-/:?=&', '+()[]!%#', "'\";,<>\\|{}"]
const ACCENTS = ['áčďéěíňó', 'řšťúůýž']

/** A compact remote keyboard. Accents and symbols are opt-in; suggestions stay offline. */
export function Keyboard({ onKey, onDone, doneLabel = 'Hotovo', value = '', onChange, candidates = [], suggest = true }: {
  onKey: (k: string) => void
  onDone?: () => void
  doneLabel?: string
  value?: string
  onChange?: (value: string) => void
  candidates?: string[]
  suggest?: boolean
}) {
  const [upper, setUpper] = useState(false)
  const [symbols, setSymbols] = useState(false)
  const [accents, setAccents] = useState(false)
  const suggestions = suggest && onChange ? wordSuggestions(value, candidates) : []
  // A new keyboard starts typing at the end of the text.
  useEffect(() => caretFromEnd.set(0), [])
  const keys = (rows: string[], prefix: string) => rows.map((row, r) => (
    <div class={`kb-row${prefix === 'letter' ? ` kb-letter-row kb-letter-row-${r}` : ''}`} key={`${prefix}-${r}`}>
      {row.split('').map((ch, col) => {
        const k = upper ? ch.toUpperCase() : ch
        return <div role="button" class="kb-key" key={ch} data-focus={`kb-${prefix}-${r}-${col}`}
          data-autofocus={prefix === 'letter' && r === 1 && col === 0 ? '' : undefined} onClick={() => onKey(k)}>{k}</div>
      })}
    </div>
  ))
  return (
    <div class={`keyboard${accents ? ' has-accents' : ''}`}>
      {suggest && onChange && <div class="kb-suggestions" role="group" aria-label="Návrhy slov">
        {suggestions.length ? suggestions.map((word) => (
          <div role="button" key={word} class="kb-suggestion" data-focus={`kb-suggest-${word}`} onClick={() => onChange(completeWord(value, word))}>{word}</div>
        )) : <span class="kb-suggestion-hint">Návrhy slov</span>}
      </div>}
      <div class="kb-tools">
        <div role="button" class={`kb-key kb-tool${upper ? ' selected' : ''}`} data-focus="kb-shift" aria-pressed={upper} onClick={() => setUpper(!upper)}>{upper ? 'abc' : 'ABC'}</div>
        <div role="button" class={`kb-key kb-tool${symbols ? ' selected' : ''}`} data-focus="kb-symbols" aria-pressed={symbols} onClick={() => setSymbols(!symbols)}>{symbols ? 'Písmena' : '123 / #+'}</div>
        <div role="button" class={`kb-key kb-tool${accents ? ' selected' : ''}`} data-focus="kb-accents" aria-pressed={accents} onClick={() => setAccents(!accents)}>ÁČĚ <span class="kb-tool-label">Diakritika</span></div>
      </div>
      {accents && <div class="kb-accent-panel">{keys(ACCENTS, 'accent')}</div>}
      <div class="kb-letters">{keys(symbols ? SYMBOLS : LETTERS, symbols ? 'symbol' : 'letter')}</div>
      <div class="kb-row kb-shortcuts">
        <div role="button" class="kb-key" data-focus="kb-caret-left" aria-label="Kurzor doleva" onClick={() => onKey(KEY_LEFT)}>◀</div>
        <div role="button" class="kb-key" data-focus="kb-caret-right" aria-label="Kurzor doprava" onClick={() => onKey(KEY_RIGHT)}>▶</div>
        {['.', '@', '/', '-'].map((ch) => <div role="button" class="kb-key" key={ch} data-focus={`kb-shortcut-${ch}`} onClick={() => onKey(ch)}>{ch}</div>)}
        <div role="button" class="kb-key kb-wide" data-focus="kb-back" aria-label="Smazat znak před kurzorem" onClick={() => onKey('\b')}>Smazat znak</div>
      </div>
      <div class="kb-row kb-actions">
        <div role="button" class="kb-key kb-space" data-focus="kb-space" onClick={() => onKey(' ')}>Mezera</div>
        <div role="button" class="kb-key kb-wide" data-focus="kb-clear" onClick={() => onKey('\u0018')}>Vymazat vše</div>
        {onDone && <div role="button" class="kb-key kb-wide kb-done" data-focus="kb-done" onClick={onDone}>{doneLabel}</div>}
      </div>
    </div>
  )
}

/**
 * Applies a keyboard key at the caret: \b deletes the character before it, \u0018 clears everything,
 * ← and → move the caret, anything else is inserted.
 */
export function applyKey(value: string, key: string): string {
  caretKeys.set((n) => n + 1)
  const back = Math.min(caretFromEnd.get(), value.length)
  const pos = value.length - back
  if (key === KEY_LEFT) {
    caretFromEnd.set(Math.min(back + 1, value.length))
    return value
  }
  if (key === KEY_RIGHT) {
    caretFromEnd.set(Math.max(back - 1, 0))
    return value
  }
  if (key === '\b') return pos > 0 ? value.slice(0, pos - 1) + value.slice(pos) : value
  if (key === '\u0018') {
    caretFromEnd.set(0)
    return ''
  }
  const next = value.slice(0, pos) + key + value.slice(pos)
  // Past the length limit the text is cut at the end, so the caret stays after the inserted key.
  return next.length > 200 ? next.slice(0, 200) : next
}
