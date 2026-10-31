import { describe, expect, it } from 'vitest'
import { dayPart, formatTime, greeting, homeRows, ticksToSeconds, weatherText } from './context.ts'
import { streamFor } from './jellyfin.ts'
import { parseM3u } from './m3u.ts'
import { bestMatch, matchScore, normalize, textEdit, toUrl } from './text.ts'

describe('text', () => {
  it('normalizes Czech text', () => {
    expect(normalize('  Pusť ČT24!  ')).toBe('pust ct24')
  })

  it('ranks exact, prefix and word matches', () => {
    expect(matchScore('ct24', 'ČT24')).toBe(1)
    expect(matchScore('ct', 'ČT24')).toBe(0.9)
    expect(matchScore('mandalorian', 'The Mandalorian')).toBe(0.8)
    expect(matchScore('xyz', 'ČT24')).toBe(0)
    expect(bestMatch('nova', ['ČT1', 'Nova Cinema', 'Nova'], (s) => s)).toBe('Nova')
  })
})

describe('toUrl', () => {
  it('keeps URLs, completes domains and searches the rest', () => {
    expect(toUrl('https://ct24.ceskatelevize.cz')).toBe('https://ct24.ceskatelevize.cz')
    expect(toUrl('seznam.cz')).toBe('https://seznam.cz')
    expect(toUrl('idnes.cz/zpravy')).toBe('https://idnes.cz/zpravy')
    expect(toUrl('192.168.0.10:8096')).toBe('http://192.168.0.10:8096')
    expect(toUrl('počasí praha')).toBe('https://www.google.com/search?q=po%C4%8Das%C3%AD%20praha')
    expect(toUrl('javascript:alert(1)').startsWith('https://www.google.com/search')).toBe(true)
  })
})

describe('context', () => {
  it('splits the day and greets', () => {
    expect(dayPart(7)).toBe('morning')
    expect(dayPart(20)).toBe('evening')
    expect(dayPart(2)).toBe('night')
    expect(greeting(13)).toBe('Dobré odpoledne')
  })

  it('puts unfinished episodes first in the evening', () => {
    expect(homeRows(21)[0]).toBe('resume')
    expect(homeRows(9)[0]).toBe('apps')
  })

  it('formats times and ticks', () => {
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(3723)).toBe('1:02:03')
    expect(ticksToSeconds(600_000_000)).toBe(60)
    expect(weatherText(0).text).toBe('Jasno')
    expect(weatherText(95).text).toBe('Bouřky')
  })
})

describe('streamFor', () => {
  it('plays the file directly when possible', () => {
    const s = streamFor('http://jf:8096/', 'tok', 'abc', { Id: 'ms1', SupportsDirectPlay: true })
    expect(s).toEqual({
      url: 'http://jf:8096/Videos/abc/stream?static=true&mediaSourceId=ms1&api_key=tok',
      hls: false,
      method: 'DirectPlay',
    })
  })

  it('falls back to the HLS transcode', () => {
    const s = streamFor('http://jf:8096', 'tok', 'abc', {
      Id: 'ms1',
      TranscodingUrl: '/videos/abc/master.m3u8?ApiKey=tok',
      TranscodingSubProtocol: 'hls',
    })
    expect(s).toEqual({ url: 'http://jf:8096/videos/abc/master.m3u8?ApiKey=tok', hls: true, method: 'Transcode' })
  })

  it('returns null when nothing can play', () => {
    expect(streamFor('http://jf', 't', 'a', { Id: 'x' })).toBeNull()
  })
})

describe('parseM3u', () => {
  it('reads names, logos, groups and URLs', () => {
    const list = parseM3u(
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="ct24" tvg-logo="http://logo/ct24.png" group-title="Zprávy",ČT24',
        'https://example.com/ct24.m3u8',
        '#EXTINF:-1,Bez skupiny, s čárkou',
        '#EXTGRP:Ostatní',
        'http://example.com/x.m3u8',
        '#EXTINF:-1,Rozbitý',
        'not a url',
      ].join('\n'),
    )
    expect(list).toEqual([
      { id: '1', name: 'ČT24', logo: 'http://logo/ct24.png', group: 'Zprávy', url: 'https://example.com/ct24.m3u8' },
      { id: '2', name: 'Bez skupiny, s čárkou', logo: undefined, group: 'Ostatní', url: 'http://example.com/x.m3u8' },
    ])
  })
})

describe('textEdit', () => {
  it('types only what changed at the end', () => {
    expect(textEdit('', 'ahoj')).toEqual({ backspaces: 0, insert: 'ahoj' })
    expect(textEdit('ahoj', 'ahoj s')).toEqual({ backspaces: 0, insert: ' s' })
    expect(textEdit('ahoj', 'aho')).toEqual({ backspaces: 1, insert: '' })
    expect(textEdit('ahoj svete', 'ahoj světe')).toEqual({ backspaces: 3, insert: 'ěte' })
  })
})
