import { useEffect, useRef, useState } from 'preact/hooks'
import { CLOCKS, DESIGNS, FONTS, LABEL_STYLES, SCENES, sceneUrl, TILE_STYLES, type Appearance, type CustomBackground, type DesignId, type Option } from '../../shared/appearance.ts'

/** Brand-like colours for the little design previews. */
const SWATCHES = ['#e50914', '#ff3b30', '#1a73e8', '#1a3cd6', '#2ed3c3', '#f6ad55', '#7b2ff7', '#c6f432']

function blocks(n: number, cls: string, glass: boolean) {
  return Array.from({ length: n }, (_, i) => <i key={i} class={cls} style={glass ? undefined : { background: SWATCHES[i % SWATCHES.length] }} />)
}

/** A schematic of each design, drawn over the chosen background. */
function Mini({ design }: { design: DesignId }) {
  switch (design) {
    case 'spotlight':
      return <div class="mini mini-spotlight"><b class="mini-headline" /><b class="mini-headline short" /><div class="mini-row">{blocks(4, 'mini-tile', false)}</div></div>
    case 'mosaic':
      return <div class="mini mini-mosaic"><i class="mini-big" style={{ background: SWATCHES[0] }} /><div class="mini-rest">{blocks(6, 'mini-tile', false)}</div></div>
    case 'sidebar':
      return <div class="mini mini-sidebar"><div class="mini-list">{blocks(6, 'mini-line', false)}</div><i class="mini-preview" style={{ background: SWATCHES[3] }} /></div>
    case 'dock':
      return <div class="mini mini-dock"><b class="mini-clock" /><div class="mini-row">{blocks(5, 'mini-tile', true)}</div></div>
    case 'minimal':
      return <div class="mini mini-minimal"><b class="mini-clock" /><div class="mini-row">{blocks(6, 'mini-dot', true)}</div></div>
    case 'shore':
      return <div class="mini mini-grid glass">{blocks(8, 'mini-tile', true)}</div>
    default:
      return <div class="mini mini-grid">{blocks(10, 'mini-tile', false)}</div>
  }
}

/** Shrinks a phone photo to TV size before sending: faster upload, and TVs decode it easily. */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Tuhle fotku se nepodařilo otevřít.'))
      i.src = url
    })
    const scale = Math.min(1, 2560 / img.naturalWidth, 1440 / img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Fotku se nepodařilo zmenšit.'))), 'image/jpeg', 0.86))
  } finally {
    URL.revokeObjectURL(url)
  }
}

function Segmented<T extends string>({ label, options, value, onPick }: { label: string; options: Option<T>[]; value: T; onPick: (v: T) => void }) {
  return (
    <div class="look-option">
      <div class="look-option-label">{label}</div>
      <div class="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} role="radio" aria-checked={o.id === value} class={o.id === value ? 'on' : ''} onClick={() => onPick(o.id)}>{o.name}</button>
        ))}
      </div>
    </div>
  )
}

/** The phone's Design tab: everything the TV's Appearance panel can change, plus own photos. */
export function DesignTab({ look, photos, token, onChange }: {
  look: Appearance | null
  photos: CustomBackground[]
  token: string
  onChange: (patch: Partial<Appearance>) => void
}) {
  const [immich, setImmich] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json() as Promise<{ features?: { photos?: boolean } }>)
      .then((c) => setImmich(!!c.features?.photos), () => {})
  }, [])

  if (!look) return <p class="muted center">Čekám na hub…</p>

  const pick = (patch: Partial<Appearance>) => {
    navigator.vibrate?.(12)
    onChange(patch)
  }
  const current = SCENES.find((s) => `scene:${s.id}` === look.background)
  const currentPhoto = look.background.startsWith('photo:') ? `/api/backgrounds/${look.background.slice(6)}` : null
  const backdrop = current ? sceneUrl(current, true) : currentPhoto

  const upload = async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    ;(e.target as HTMLInputElement).value = ''
    if (!f) return
    setBusy(true)
    setError('')
    try {
      const body = await shrink(f)
      const res = await fetch(`/api/backgrounds?use=1&name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' }, body })
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Nahrání se nepovedlo.')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async (p: CustomBackground) => {
    if (!confirm(`Smazat fotku „${p.name}“?`)) return
    const res = await fetch(`/api/backgrounds/${p.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) setError('Fotku se nepodařilo smazat.')
  }

  return (
    <div class="design">
      <h1 class="design-title">Udělejte si televizi po svém</h1>
      <p class="muted design-sub">Ťukněte na návrh nebo pozadí, televize se změní hned.</p>

      <h2>Návrh</h2>
      <div class="design-strip">
        {DESIGNS.map((d) => (
          <button key={d.id} class={`design-card${d.id === look.design ? ' on' : ''}`} aria-pressed={d.id === look.design} onClick={() => pick({ design: d.id })}>
            <div class="design-thumb" style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined}>
              <Mini design={d.id} />
              {d.id === look.design && <span class="badge">Teď</span>}
            </div>
            <strong>{d.name}</strong>
            <span>{d.description}</span>
          </button>
        ))}
      </div>

      <h2>Pozadí</h2>
      <div class="bg-grid">
        {SCENES.map((s) => {
          const id = `scene:${s.id}`
          return (
            <button key={id} class={`bg-tile${look.background === id ? ' on' : ''}`} aria-pressed={look.background === id} style={{ backgroundImage: `url("${sceneUrl(s, true)}")` }} onClick={() => pick({ background: id })}>
              <span>{s.name}</span>
            </button>
          )
        })}
        {photos.map((p) => {
          const id = `photo:${p.id}`
          return (
            <div key={id} class="bg-cell">
              <button class={`bg-tile${look.background === id ? ' on' : ''}`} aria-pressed={look.background === id} style={{ backgroundImage: `url("/api/backgrounds/${p.id}")` }} onClick={() => pick({ background: id })}>
                <span>{p.name}</span>
              </button>
              <button class="bg-remove" aria-label={`Smazat ${p.name}`} onClick={() => void remove(p)}>×</button>
            </div>
          )
        })}
        {immich && (
          <button class={`bg-tile bg-plain${look.background === 'immich' ? ' on' : ''}`} aria-pressed={look.background === 'immich'} onClick={() => pick({ background: 'immich' })}>
            <span>Fotky z Immich</span>
          </button>
        )}
        <button class={`bg-tile bg-plain${look.background === 'none' ? ' on' : ''}`} aria-pressed={look.background === 'none'} onClick={() => pick({ background: 'none' })}>
          <span>Bez pozadí</span>
        </button>
        <button class="bg-tile bg-upload" disabled={busy} onClick={() => file.current?.click()}>
          <span class="plus">+</span>
          <span>{busy ? 'Nahrávám…' : 'Vlastní fotka'}</span>
        </button>
        <input ref={file} type="file" accept="image/*" hidden onChange={upload} />
      </div>
      {error && <div class="result error">{error}</div>}

      <h2>Úpravy</h2>
      <Segmented label="Dlaždice" options={TILE_STYLES} value={look.tiles} onPick={(tiles) => pick({ tiles })} />
      <Segmented label="Popisky" options={LABEL_STYLES} value={look.labels} onPick={(labels) => pick({ labels })} />
      <Segmented label="Písmo" options={FONTS} value={look.font} onPick={(font) => pick({ font })} />
      <Segmented label="Hodiny" options={CLOCKS} value={look.clock} onPick={(clock) => pick({ clock })} />
    </div>
  )
}
