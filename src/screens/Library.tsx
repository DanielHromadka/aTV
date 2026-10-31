import { useEffect, useState } from 'preact/hooks'
import { Button, Card, Message, Spinner } from '../components'
import { nav, useStore } from '../state'
import { jellyfin, type Item } from '../services/jellyfin'
import { settings } from '../services/settings'

/** Without a parent: the user's libraries. With one: its content as a poster grid. */
export function Library({ parentId, title, collectionType }: { parentId?: string; title?: string; collectionType?: string }) {
  const s = useStore(settings)
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const jf = jellyfin()
    if (!jf) return
    let cancelled = false
    setItems(null)
    ;(parentId ? jf.items(parentId, collectionType) : jf.views())
      .then((list) => !cancelled && setItems(list))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [parentId, collectionType, s.jellyfin])

  const jf = jellyfin()
  if (!jf) {
    return (
      <div class="screen-body padded">
        <h1 class="screen-title">Knihovna</h1>
        <Message>Knihovna používá Jellyfin, open-source mediální server. Přihlaste se ke svému serveru.</Message>
        <Button id="login" label="Přihlásit k Jellyfinu" primary autofocus onClick={() => nav.push({ type: 'login' })} />
      </div>
    )
  }

  const landscape = !parentId
  return (
    <div class="screen-body padded" data-scroll="y">
      <h1 class="screen-title">{title ?? 'Knihovna'}</h1>
      {error && <Message>{error}</Message>}
      {!items && !error && <Spinner />}
      {items && !items.length && <Message>Tady zatím nic není.</Message>}
      <div class="grid">
        {items?.map((i) => (
          <Card
            key={i.Id}
            id={`item-${i.Id}`}
            landscape={landscape}
            title={i.Name}
            subtitle={i.ProductionYear ? String(i.ProductionYear) : undefined}
            image={jf.cardImage(i, landscape, landscape ? 270 : 360)}
            progress={(i.UserData?.PlayedPercentage ?? 0) / 100}
            onClick={() =>
              parentId
                ? nav.push({ type: 'detail', itemId: i.Id })
                : nav.push({ type: 'library', parentId: i.Id, title: i.Name, collectionType: i.CollectionType })
            }
          />
        ))}
      </div>
    </div>
  )
}
