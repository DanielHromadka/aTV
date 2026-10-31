import { useEffect, useState } from 'preact/hooks'
import type { Channel } from '../../shared/m3u.ts'
import { Card, Message, Row, Spinner } from '../components'
import { nav } from '../state'
import { loadChannels } from '../services/hub'

/** Live channels from the hub's M3U playlist, one row per group. */
export function Iptv() {
  const [list, setList] = useState<Channel[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadChannels().then(setList, (e: Error) => setError(e.message))
  }, [])

  const groups: { name: string; channels: Channel[] }[] = []
  for (const ch of list ?? []) {
    const name = ch.group ?? 'Kanály'
    const g = groups.find((x) => x.name === name)
    if (g) g.channels.push(ch)
    else groups.push({ name, channels: [ch] })
  }

  return (
    <div class="screen-body padded-top" data-scroll="y">
      <h1 class="screen-title padded-x">Televize</h1>
      {error && <Message>{error}</Message>}
      {!list && !error && <Spinner />}
      {list && !list.length && <Message>Playlist neobsahuje žádné kanály.</Message>}
      {groups.map((g) => (
        <Row key={g.name} title={g.name}>
          {g.channels.map((ch) => (
            <Card
              key={ch.id}
              id={`ch-${ch.id}`}
              landscape
              title={ch.name}
              image={ch.logo}
              fallback={ch.name}
              onClick={() => nav.push({ type: 'player', source: { kind: 'url', url: ch.url, title: ch.name, live: true } })}
            />
          ))}
        </Row>
      ))}
    </div>
  )
}
