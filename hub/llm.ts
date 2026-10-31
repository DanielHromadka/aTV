import Anthropic from '@anthropic-ai/sdk'
import { APPS } from '../shared/apps.ts'
import { toIntent, type Intent } from '../shared/intents.ts'

const SYSTEM = `Převádíš české hlasové a textové příkazy pro televizní prostředí aTV na jednu akci.
Druhy akcí (pole "kind"):
- launch: spustit aplikaci; "app" je jedno z: ${APPS.map((a) => `${a.id} (${a.name})`).join(', ')}
- play: pustit film, seriál nebo pořad z domácí knihovny; "query" je název v základním tvaru (1. pád)
- channel: přepnout na televizní kanál; "query" je název kanálu
- search: vyhledat; "query"
- navigate: otevřít obrazovku; "screen" je home, library, tv, search, settings nebo appearance (vzhled domovské obrazovky)
- playback: "action" je pause, resume nebo stop
- tv: tlačítko televize; "key" je volup, voldown, mute, power, chup nebo chdown; "repeat" kolikrát (jinak 1)
- power-on: zapnout televizi
- sleep: časovač vypnutí; "minutes" za kolik minut, null zruší časovač
- none: příkaz nesouvisí s televizí nebo mu nerozumíš
Nevyplněná pole nastav na null.`

const NULLABLE_STRING = { type: ['string', 'null'] }
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'app', 'query', 'screen', 'action', 'key', 'repeat', 'minutes'],
  properties: {
    kind: { type: 'string', enum: ['launch', 'play', 'channel', 'search', 'navigate', 'playback', 'tv', 'power-on', 'sleep', 'none'] },
    app: NULLABLE_STRING,
    query: NULLABLE_STRING,
    screen: NULLABLE_STRING,
    action: NULLABLE_STRING,
    key: NULLABLE_STRING,
    repeat: { type: ['integer', 'null'] },
    minutes: { type: ['integer', 'null'] },
  },
}

/** Asks Claude to map a command the rules did not understand; null when it is not a TV command. */
export async function interpretWithClaude(apiKey: string, text: string): Promise<Intent | null> {
  const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 })
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 1024,
    // A simple classification: low effort keeps the answer quick.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    // On a safety decline the request re-runs on a fallback model in the same call.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: text.slice(0, 500) }],
  })
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null
  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(block.text) as Record<string, unknown>
  } catch {
    return null
  }
  // The schema makes every field required; drop the nulls before validating.
  const clean = Object.fromEntries(Object.entries(parsed).filter(([k, v]) => v !== null || k === 'minutes'))
  if (clean.kind === 'tv' && clean.repeat === undefined) delete clean.repeat
  return toIntent(clean)
}
