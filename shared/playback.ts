export type PlayerSource =
  | { kind: 'jellyfin'; itemId: string; title: string; startSeconds?: number }
  | {
      kind: 'url'
      url: string
      title: string
      poster?: string
      audioOnly?: boolean
      /** Stable torrent/file identity, independent of stream/audio selection. */
      historyId?: string
      mediaKey?: string
      live?: boolean
      /** For transcoded streams: the URL with `{t}` for the start second, so seeking restarts the stream there. */
      seekTemplate?: string
      duration?: number
      startSeconds?: number
      /** One subtitle track (WebVTT); `{t}` in its URL is replaced like in seekTemplate. */
      subtitle?: { label: string; lang?: string; src: string; /** Starts hidden; Down on the remote turns it on. */ off?: boolean }
    }

