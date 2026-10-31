import { useState } from 'preact/hooks'
import { Keyboard, TextField, applyKey } from '../components'
import { nav, useScreenText } from '../state'

/** Edits one text value with the on-screen keyboard (or the phone); Hotovo saves it. */
export function KeyboardScreen({ title, value: initial, secret, onDone, screenKey }: { title: string; value: string; secret?: boolean; onDone: (v: string) => void; screenKey: number }) {
  const [value, setValue] = useState(initial)
  const done = (v = value) => {
    nav.pop()
    onDone(v.trim())
  }
  useScreenText(screenKey, (text, submit) => (submit ? done(text) : setValue(text)))
  return (
    <div class="screen-body padded keyboard-screen">
      <h1 class="screen-title">{title}</h1>
      <TextField value={value} onChange={setValue} label={title} secret={secret} wide onSubmit={() => done()} />
      <Keyboard value={value} onChange={setValue} suggest={!secret} onKey={(k) => setValue((v) => applyKey(v, k))} onDone={() => done()} />
      <div class="search-hint">Psát můžete i z mobilu</div>
    </div>
  )
}
