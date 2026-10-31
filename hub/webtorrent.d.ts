// WebTorrent ships no types; hub/torrents.ts declares the parts it uses.
declare module 'webtorrent' {
  const WebTorrent: unknown
  export default WebTorrent
}
