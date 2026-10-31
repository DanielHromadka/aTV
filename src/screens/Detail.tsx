import { useEffect, useState } from 'preact/hooks'
import { formatTime, ticksToSeconds } from '../../shared/context.ts'
import { playItem } from '../actions'
import { Button, Card, Message, Row, Spinner } from '../components'
import { nav } from '../state'
import { isPlayable, itemTitle, jellyfin, type Item } from '../services/jellyfin'
import { ActorCard } from './Actors'

/** One title: description, play buttons, and episodes or other children. */
export function Detail({ itemId, active }: { itemId: string; active: boolean }) {
  const [item, setItem] = useState<Item | null>(null)
  const [children, setChildren] = useState<Item[]>([])
  const [nextUp, setNextUp] = useState<Item | null>(null)
  const [error, setError] = useState('')

  // Reloaded when coming back from the player, so the resume position is fresh.
  useEffect(() => {
    const jf = jellyfin()
    if (!jf || !active) return
    let cancelled = false
    jf.item(itemId)
      .then(async (it) => {
        if (cancelled) return
        setItem(it)
        if (it.Type === 'Series') {
          const [eps, next] = await Promise.all([jf.episodes(it.Id), jf.nextUp(it.Id)])
          if (!cancelled) {
            setChildren(eps)
            setNextUp(next[0] ?? null)
          }
        } else if (it.IsFolder) {
          const kids = await jf.children(it.Id)
          if (!cancelled) setChildren(kids)
        }
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [itemId, active])

  const jf = jellyfin()
  if (error) return <div class="screen-body padded"><Message>{error}</Message></div>
  if (!item || !jf) return <div class="screen-body padded"><Spinner /></div>

  const backdrop = item.BackdropImageTags?.length
    ? jf.image(item.Id, 'Backdrop', 1080, item.BackdropImageTags[0])
    : item.ParentBackdropItemId
      ? jf.image(item.ParentBackdropItemId, 'Backdrop', 1080, item.ParentBackdropImageTags?.[0])
      : undefined
  const position = ticksToSeconds(item.UserData?.PlaybackPositionTicks)
  const meta = [
    item.ProductionYear,
    item.RunTimeTicks ? formatTime(ticksToSeconds(item.RunTimeTicks)) : undefined,
    item.OfficialRating,
    item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : undefined,
  ].filter(Boolean)

  // Group episodes by season, one row each.
  const seasons: { name: string; items: Item[] }[] = []
  for (const c of children) {
    const name = item.Type === 'Series' ? c.SeasonName ?? `Řada ${c.ParentIndexNumber ?? '?'}` : 'Obsah'
    const last = seasons[seasons.length - 1]
    if (last && last.name === name) last.items.push(c)
    else seasons.push({ name, items: [c] })
  }

  return (
    <div class="screen-body detail" data-scroll="y">
      {backdrop && <div class="backdrop" style={{ backgroundImage: `url("${backdrop}")` }} />}
      <div class="detail-info">
        <h1 class="detail-title">{item.SeriesName ? `${item.SeriesName}` : item.Name}</h1>
        {item.SeriesName && <div class="detail-sub">{itemTitle(item)}</div>}
        <div class="detail-meta">{meta.join('  ·  ')}</div>
        {item.Overview && <p class="detail-overview">{item.Overview}</p>}
        <div class="buttons">
          {isPlayable(item) && position > 0 && (
            <Button id="resume" primary autofocus label={`▶ Pokračovat od ${formatTime(position)}`} onClick={() => void playItem(item)} />
          )}
          {isPlayable(item) && (
            <Button id="play" primary={position === 0} autofocus={position === 0} label={position > 0 ? 'Od začátku' : '▶ Přehrát'} onClick={() => void playItem(item, true)} />
          )}
          {item.Type === 'Series' && nextUp && (
            <Button id="nextup" primary autofocus label={`▶ ${itemTitle(nextUp)}`} onClick={() => void playItem(nextUp)} />
          )}
        </div>
      </div>
      {!!item.People?.some((p) => p.Type === 'Actor') && <Row title="Hrají">
        {item.People.filter((p) => p.Type === 'Actor').map((p) => <ActorCard key={p.Id} actor={{ id: p.Id, name: p.Name, source: 'jellyfin', knownFor: p.Role,
          photo: p.PrimaryImageTag ? jf.image(p.Id, 'Primary', 360, p.PrimaryImageTag) : undefined }} />)}
      </Row>}
      {seasons.map((s) => (
        <Row key={s.name} title={s.name}>
          {s.items.map((c) => (
            <Card
              key={c.Id}
              id={`child-${c.Id}`}
              landscape={c.Type === 'Episode' || c.MediaType === 'Video'}
              title={c.Type === 'Episode' ? itemTitle(c) : c.Name}
              image={jf.cardImage(c, c.Type === 'Episode', 270)}
              progress={(c.UserData?.PlayedPercentage ?? 0) / 100}
              subtitle={c.UserData?.Played ? '✓ Zhlédnuto' : undefined}
              onClick={() => (isPlayable(c) ? void playItem(c) : nav.push({ type: 'detail', itemId: c.Id }))}
            />
          ))}
        </Row>
      ))}
    </div>
  )
}
