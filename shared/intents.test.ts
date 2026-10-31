import { describe, expect, it } from 'vitest'
import { parseCommand, toIntent } from './intents.ts'

describe('parseCommand', () => {
  it('launches apps by name and alias', () => {
    expect(parseCommand('Pusť Netflix')).toEqual({ kind: 'launch', app: 'netflix' })
    expect(parseCommand('zapni jůtůb')).toEqual({ kind: 'launch', app: 'youtube' })
    expect(parseCommand('otevři Disney+')).toEqual({ kind: 'launch', app: 'disney' })
    expect(parseCommand('Telly')).toEqual({ kind: 'launch', app: 'telly' })
  })

  it('treats other "pusť X" as something to play', () => {
    expect(parseCommand('pusť Mandaloriana')).toEqual({ kind: 'play', query: 'mandaloriana' })
    expect(parseCommand('pusť film Pelíšky')).toEqual({ kind: 'play', query: 'pelisky' })
  })

  it('sets and cancels the sleep timer', () => {
    expect(parseCommand('vypni televizi za 30 minut')).toEqual({ kind: 'sleep', minutes: 30 })
    expect(parseCommand('uspi za půl hodiny')).toEqual({ kind: 'sleep', minutes: 30 })
    expect(parseCommand('vypni za hodinu')).toEqual({ kind: 'sleep', minutes: 60 })
    expect(parseCommand('vypni za dvě hodiny')).toEqual({ kind: 'sleep', minutes: 120 })
    expect(parseCommand('zruš časovač')).toEqual({ kind: 'sleep', minutes: null })
  })

  it('controls the TV', () => {
    expect(parseCommand('vypni televizi')).toEqual({ kind: 'tv', key: 'power' })
    expect(parseCommand('zapni televizi')).toEqual({ kind: 'power-on' })
    expect(parseCommand('zesil o 5')).toEqual({ kind: 'tv', key: 'volup', repeat: 5 })
    expect(parseCommand('ztiš')).toEqual({ kind: 'tv', key: 'voldown', repeat: 2 })
    expect(parseCommand('vypni zvuk')).toEqual({ kind: 'tv', key: 'mute' })
  })

  it('controls playback, navigation, search and channels', () => {
    expect(parseCommand('pauza')).toEqual({ kind: 'playback', action: 'pause' })
    expect(parseCommand('pokračuj')).toEqual({ kind: 'playback', action: 'resume' })
    expect(parseCommand('otevři nastavení')).toEqual({ kind: 'navigate', screen: 'settings' })
    expect(parseCommand('domů')).toEqual({ kind: 'navigate', screen: 'home' })
    expect(parseCommand('najdi Star Wars')).toEqual({ kind: 'search', query: 'star wars' })
    expect(parseCommand('přepni na ČT24')).toEqual({ kind: 'channel', query: 'ct24' })
    expect(parseCommand('otevři prohlížeč')).toEqual({ kind: 'navigate', screen: 'browser' })
    expect(parseCommand('otevři seznam.cz')).toEqual({ kind: 'open-url', url: 'https://seznam.cz' })
  })

  it('returns null for what it does not understand', () => {
    expect(parseCommand('jaké bude zítra počasí')).toBeNull()
    expect(parseCommand('otevři ledničku')).toBeNull()
    expect(parseCommand('')).toBeNull()
  })
})

describe('toIntent', () => {
  it('accepts valid intents and clamps numbers', () => {
    expect(toIntent({ kind: 'launch', app: 'netflix' })).toEqual({ kind: 'launch', app: 'netflix' })
    expect(toIntent({ kind: 'tv', key: 'volup', repeat: 99 })).toEqual({ kind: 'tv', key: 'volup', repeat: 20 })
    expect(toIntent({ kind: 'sleep', minutes: null })).toEqual({ kind: 'sleep', minutes: null })
  })

  it('rejects unknown kinds, apps and values', () => {
    expect(toIntent({ kind: 'launch', app: 'hbo' })).toBeNull()
    expect(toIntent({ kind: 'tv', key: 'self-destruct' })).toBeNull()
    expect(toIntent({ kind: 'sleep', minutes: -5 })).toBeNull()
    expect(toIntent({ kind: 'play', query: '' })).toBeNull()
    expect(toIntent('play')).toBeNull()
    expect(toIntent({ kind: 'open-url', url: 'javascript:alert(1)' })).toBeNull()
  })
})
