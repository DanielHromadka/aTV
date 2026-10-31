export interface Channel {
  id: string
  name: string
  url: string
  logo?: string
  group?: string
}

const ATTR = /([a-z0-9-]+)="([^"]*)"/gi

/** Parses an extended M3U playlist (#EXTINF with tvg-* attributes); skips entries without a URL. */
export function parseM3u(text: string): Channel[] {
  const channels: Channel[] = []
  let pending: Omit<Channel, 'url' | 'id'> | null = null
  let group: string | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXTINF')) {
      const comma = line.indexOf(',', line.lastIndexOf('"') + 1)
      const name = (comma >= 0 ? line.slice(comma + 1) : '').trim()
      const attrs: Record<string, string> = {}
      for (const m of line.matchAll(ATTR)) attrs[m[1].toLowerCase()] = m[2]
      pending = {
        name: name || attrs['tvg-name'] || 'Kanál',
        logo: attrs['tvg-logo'] || undefined,
        group: attrs['group-title'] || group,
      }
    } else if (line.startsWith('#EXTGRP:')) {
      group = line.slice(8).trim() || undefined
      if (pending && !pending.group) pending.group = group
    } else if (!line.startsWith('#')) {
      if (pending && /^(https?|rtmp|rtsp|udp):\/\//i.test(line)) {
        channels.push({ id: String(channels.length + 1), ...pending, url: line })
      }
      pending = null
    }
  }
  return channels
}
