import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findChrome } from './browser.ts'
import { avSupported } from './browser-av.ts'
import type { JackettConfig } from './jackett.ts'
import type { PublicConfig } from '../shared/protocol.ts'

/** Everything the hub reads from data/config.json, overridable by environment variables. */
export interface HubConfig {
  port: number
  /** Where phones reach the hub (QR code); detected from the network when empty. */
  publicUrl?: string
  dataDir: string
  distDir: string
  jellyfinUrl?: string
  samsung?: { host: string; mac?: string; name?: string }
  iptv?: { playlist: string }
  immich?: { url: string; apiKey: string; albumId?: string }
  homeAssistant?: { url: string; token: string; scenes?: { playing?: string; stopped?: string } }
  jackett?: JackettConfig
  anthropicApiKey?: string
  tmdbApiKey?: string
  /** Chrome or Chromium for aTV's own browser; found automatically when not set. */
  chromePath?: string
  weather: { lat: number; lon: number; name: string }
}

type FileConfig = Partial<Omit<HubConfig, 'dataDir' | 'distDir'>>

export function loadConfig(env = process.env): HubConfig {
  const dataDir = env.ATV_DATA ?? 'data'
  let file: FileConfig = {}
  try {
    file = JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8')) as FileConfig
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`data/config.json: ${(e as Error).message}`)
  }
  const samsungHost = env.SAMSUNG_HOST ?? file.samsung?.host
  const immichUrl = env.IMMICH_URL ?? file.immich?.url
  const immichKey = env.IMMICH_API_KEY ?? file.immich?.apiKey
  const haUrl = env.HA_URL ?? file.homeAssistant?.url
  const haToken = env.HA_TOKEN ?? file.homeAssistant?.token
  const playlist = env.IPTV_PLAYLIST ?? file.iptv?.playlist
  const jackettUrl = env.JACKETT_URL || file.jackett?.url
  const jackettKey = env.JACKETT_API_KEY || file.jackett?.apiKey
  return {
    jackett: jackettUrl && jackettKey ? { url: jackettUrl, apiKey: jackettKey } : undefined,
    port: Number(env.HUB_PORT ?? file.port ?? 8090),
    chromePath: findChrome(env),
    publicUrl: env.HUB_PUBLIC_URL || file.publicUrl,
    dataDir,
    distDir: env.ATV_DIST ?? 'dist',
    jellyfinUrl: env.JELLYFIN_URL ?? file.jellyfinUrl,
    samsung: samsungHost
      ? { host: samsungHost, mac: env.SAMSUNG_MAC ?? file.samsung?.mac, name: file.samsung?.name }
      : undefined,
    iptv: playlist ? { playlist } : undefined,
    immich: immichUrl && immichKey ? { url: immichUrl, apiKey: immichKey, albumId: file.immich?.albumId } : undefined,
    homeAssistant: haUrl && haToken ? { url: haUrl, token: haToken, scenes: file.homeAssistant?.scenes } : undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? file.anthropicApiKey,
    tmdbApiKey: env.TMDB_API_KEY || file.tmdbApiKey,
    weather: {
      lat: Number(env.WEATHER_LAT ?? file.weather?.lat ?? 50.0755),
      lon: Number(env.WEATHER_LON ?? file.weather?.lon ?? 14.4378),
      name: env.WEATHER_NAME ?? file.weather?.name ?? 'Praha',
    },
  }
}

export function publicConfig(c: HubConfig): PublicConfig {
  return {
    jellyfinUrl: c.jellyfinUrl,
    weather: c.weather,
    features: {
      samsung: !!c.samsung,
      iptv: !!c.iptv,
      photos: !!c.immich,
      llm: !!c.anthropicApiKey,
      homeAssistant: !!c.homeAssistant,
      browser: !!c.chromePath,
      browserAudio: !!c.chromePath && avSupported(),
      actors: !!c.tmdbApiKey,
    },
  }
}
