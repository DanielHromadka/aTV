/** Lowercase, without diacritics and punctuation, single spaces: "Pusť ČT24!" → "pust ct24". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * How well `name` matches a spoken `query`, 0 (not at all) to 1 (same text).
 * Prefix and whole-word matches rank above matches in the middle of a word.
 */
export function matchScore(query: string, name: string): number {
  const q = normalize(query)
  const n = normalize(name)
  if (!q || !n) return 0
  if (q === n) return 1
  if (n.startsWith(q)) return 0.9
  if (n.split(' ').some((w) => w === q)) return 0.8
  if (n.includes(q)) return 0.6
  // Every query word appears somewhere: "mandalorian 2" vs "The Mandalorian, season 2".
  const words = q.split(' ')
  if (words.every((w) => n.includes(w))) return 0.5
  return 0
}

/** The best match above `min`, or undefined. */
export function bestMatch<T>(query: string, items: T[], name: (item: T) => string, min = 0.5): T | undefined {
  let best: T | undefined
  let bestScore = min - Number.EPSILON
  for (const item of items) {
    const score = matchScore(query, name(item))
    if (score > bestScore) {
      best = item
      bestScore = score
    }
  }
  return best
}

/**
 * What the user typed into the address bar as a URL: a full URL stays, "seznam.cz" gets https://,
 * anything else becomes a search. Only http(s) is ever returned.
 */
export function toUrl(input: string): string {
  const text = input.trim()
  if (/^https?:\/\//i.test(text)) return text
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text)) return `https://${text}`
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/\S*)?$/i.test(text)) return `http://${text}`
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}

/**
 * How to turn `prev` into `next` by typing at the end of a field: delete back to the common
 * prefix, then insert the rest. The phone sends its whole field on every change.
 */
export function textEdit(prev: string, next: string): { backspaces: number; insert: string } {
  let common = 0
  while (common < prev.length && common < next.length && prev[common] === next[common]) common++
  return { backspaces: prev.length - common, insert: next.slice(common) }
}
