/** The parts of Jellyfin's MediaSourceInfo that decide how to play an item. */
export interface MediaSource {
  Id: string
  Container?: string
  SupportsDirectPlay?: boolean
  SupportsDirectStream?: boolean
  TranscodingUrl?: string
  TranscodingSubProtocol?: string
}

export interface Stream {
  url: string
  hls: boolean
  method: 'DirectPlay' | 'DirectStream' | 'Transcode'
}

/** Picks the URL for a media source after PlaybackInfo: the file itself when the TV can play it, else Jellyfin's transcode. */
export function streamFor(server: string, token: string, itemId: string, source: MediaSource): Stream | null {
  const base = server.replace(/\/+$/, '')
  if (source.SupportsDirectPlay || source.SupportsDirectStream) {
    const q = `static=true&mediaSourceId=${encodeURIComponent(source.Id)}&api_key=${encodeURIComponent(token)}`
    return {
      url: `${base}/Videos/${encodeURIComponent(itemId)}/stream?${q}`,
      hls: false,
      method: source.SupportsDirectPlay ? 'DirectPlay' : 'DirectStream',
    }
  }
  if (source.TranscodingUrl) {
    return {
      url: base + source.TranscodingUrl,
      hls: source.TranscodingSubProtocol === 'hls' || /\.m3u8/.test(source.TranscodingUrl),
      method: 'Transcode',
    }
  }
  return null
}

/** What a platform's player decodes natively, as a Jellyfin DeviceProfile. */
export function deviceProfile(platform: string): object {
  const tv = platform === 'tizen' || platform === 'webos' || platform === 'android'
  return {
    Name: `aTV ${platform}`,
    MaxStreamingBitrate: 40_000_000,
    MaxStaticBitrate: 100_000_000,
    MusicStreamingTranscodingBitrate: 192_000,
    DirectPlayProfiles: tv
      ? [
          { Container: 'mp4,m4v,mkv,mov,ts,webm', Type: 'Video', VideoCodec: 'h264,hevc,vp9,mpeg4', AudioCodec: 'aac,mp3,ac3,eac3,opus' },
          { Container: 'mp3,aac,flac,m4a,ogg', Type: 'Audio' },
        ]
      : [
          { Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3,opus' },
          { Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'opus,vorbis' },
          { Container: 'mp3,aac,flac,m4a,ogg', Type: 'Audio' },
        ],
    TranscodingProfiles: [
      { Container: 'ts', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3', Protocol: 'hls', Context: 'Streaming', MaxAudioChannels: '2', BreakOnNonKeyFrames: true },
      { Container: 'mp3', Type: 'Audio', AudioCodec: 'mp3', Protocol: 'http', Context: 'Streaming' },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [{ Format: 'vtt', Method: 'External' }],
  }
}
