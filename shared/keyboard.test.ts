import { expect, it } from 'vitest'
import { completeWord, wordSuggestions } from './keyboard.ts'

it('suggests Czech words without requiring diacritics', () => {
  expect(wordSuggestions('ces')).toContain('česká')
  expect(wordSuggestions('ČES').every(word => word === word.toUpperCase())).toBe(true)
})
it('uses titles from the current screen before the fallback vocabulary', () => {
  expect(wordSuggestions('har', ['Harry Potter', 'Harry Potter 2'])[0]).toBe('Harry')
  expect(wordSuggestions('har', ['Harry Potter', 'Harry Potter 2']).filter(w => w === 'Harry')).toHaveLength(1)
})
it('completes only the final word and leaves a space for the next one', () => {
  expect(completeWord('Pust har', 'Harry')).toBe('Pust Harry ')
  expect(completeWord('ahoj ', 'svět')).toBe('ahoj ')
  expect(wordSuggestions('Harry po')).toContain('Potter')
})
it('does not suggest words for URLs, emails, empty input or single characters', () => {
  for (const text of ['', 'h', 'https://seznam.cz/har', 'www.sez', 'mail@ces', 'seznam.cz']) expect(wordSuggestions(text)).toEqual([])
})
