import type { TorrentFileInfo } from './media.ts'
export const isAudio = (name: string) => /\.(mp3|m4a|m4b|aac|flac|ogg|opus|wav|wma|aiff|ape)$/i.test(name)
export const audioCategory = (n: number) => n >= 3000 && n < 4000
export const audioTracks = (files: TorrentFileInfo[]) => files.filter(f => isAudio(f.name)).sort((a,b) => a.name.localeCompare(b.name, 'cs', { numeric: true }))
export interface AudioDetails { key: string; title: string; tracks: TorrentFileInfo[]; cover?: string; peers: number }
