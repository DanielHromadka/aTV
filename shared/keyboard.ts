import { normalize } from './text.ts'

// Offline vocabulary keeps common suggestions stable as search results arrive.
const WORDS = `a aby ahoj ale ano asi až bez bude budu byl byla byli být co což či česká české český čeština člověk den dnes dobrá dobré dobrý do doma domů dva dvě film filmy hledat hledám hodina hodiny chci jak jako je jeden jedna jeho její jen ještě jsem jste jsou já kde kdo kdy když kino kniha kolik konec která které který lze malá malé malý mezi mi mít moc moje můj může můžete na nad náš naše našeho nebo než něco někdo není nechci nový nová nové o od otevřít otevři pak po pod podle pokračovat poslední potřebuji pro proč prosím první před přes při přehrát přehrávání připojení příběh přístup právě roku s se seriál seriály seznam si spustit stará staré starý svět svoji tak také tam teď ten tento tím to toho tom tomu tři ty u už v ve velká velké velký video více vlastně vy vám vás vánoce vše všechno vyhledat začít zavřít ze zítra změnit zpět zvuk žádná žádné žádný zóna z mé má nové titulky titulků českých dabing dobrodružství dokument dokumenty drama komedie pohádka pohádky rodina rodinný romantický thriller akční animovaný detektivka fantasy historie hudba horor kouzelný král království láska nejlepší noc princezna přátelé škola tajemství televize válka život Iron Man Harry Potter Pán prstenů Hobit Star Wars Simpsonovi Shrek Avatar Matrix Marvel Batman Superman Mandalorian Stranger Things YouTube Netflix Disney Google Seznam Wikipedie`.split(/\s+/)

export function wordSuggestions(value: string, candidates: string[] = [], limit = 4): string[] {
  if (/(?:https?:\/\/|www\.|@)/i.test(value) || /\S[./:]\S/.test(value)) return []
  const match = /[\p{L}\p{N}]+$/u.exec(value)
  if (!match || match[0].length < 2) return []
  const prefix = normalize(match[0])
  const previous = normalize(value.slice(0, match.index)).split(' ').pop()
  const phrases = [...candidates, 'dobrý den', 'dobré ráno', 'Harry Potter', 'Pán prstenů', 'Star Wars', 'Stranger Things', 'In the Grey', 'Iron Man']
  const nextWords = previous ? phrases.flatMap((phrase) => {
    const tokens = phrase.match(/[\p{L}\p{N}]+/gu) ?? []
    return tokens.filter((_word, i) => i > 0 && normalize(tokens[i - 1]) === previous)
  }) : []
  const words = [...nextWords, ...WORDS, ...candidates.flatMap((text) => text.match(/[\p{L}\p{N}]+/gu) ?? [])]
  const seen = new Set<string>()
  const found: string[] = []
  for (const word of words) {
    const key = normalize(word)
    if (!key.startsWith(prefix) || seen.has(key) || word.toLowerCase() === match[0].toLowerCase()) continue
    seen.add(key)
    const allUpper = match[0] === match[0].toUpperCase()
    const initialUpper = match[0][0] === match[0][0].toUpperCase()
    found.push(allUpper ? word.toUpperCase() : initialUpper ? word[0].toUpperCase() + word.slice(1) : word)
    if (found.length >= limit) break
  }
  return found
}

/** Complete only the current word; preserve earlier words, punctuation and casing. */
export function completeWord(value: string, word: string): string {
  const match = /[\p{L}\p{N}]+$/u.exec(value)
  return match ? (value.slice(0, match.index) + word + ' ').slice(0, 200) : value
}
