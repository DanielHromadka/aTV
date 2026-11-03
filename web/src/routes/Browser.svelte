<script lang="ts">
  import { toUrl } from '../../../shared/text.ts'
  import Icon from '../components/Icon.svelte'
  import Page from '../components/Page.svelte'
  import { settings, updateSettings } from '../lib/settings.svelte.ts'
  import { toast } from '../lib/toast.svelte.ts'

  /** In a desktop browser pages open in a new tab; the bookmarks are the same as on the TV. */
  let { url: initial = '' }: { url?: string } = $props()

  // svelte-ignore state_referenced_locally
  let address = $state(initial)
  let name = $state('')

  const open = (url: string) => window.open(url, '_blank', 'noopener')

  function go(e: SubmitEvent): void {
    e.preventDefault()
    if (address.trim()) open(toUrl(address))
  }
  function add(): void {
    if (!address.trim()) return toast('Nejdřív napište adresu')
    const url = toUrl(address)
    updateSettings({ bookmarks: [...settings.bookmarks, { name: name.trim() || url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''), url }] })
    name = ''
    toast('Záložka přidána')
  }
  const remove = (i: number) => updateSettings({ bookmarks: settings.bookmarks.filter((_, j) => j !== i) })
</script>

<Page title="Prohlížeč" subtitle="Stránky se otevřou v nové kartě. Záložky jsou stejné jako na televizi.">
  <form class="search-form" onsubmit={go}>
    <input class="search-field" bind:value={address} placeholder="Adresa nebo hledaný výraz" aria-label="Adresa" />
    <button class="btn primary" type="submit">Otevřít <Icon name="external" size={16} /></button>
  </form>
  <h2 class="section">Záložky</h2>
  <div class="bookmarks">
    {#each settings.bookmarks as b, i (b.url + i)}
      <div class="bookmark">
        <button class="bookmark-open" onclick={() => open(b.url)}>
          <span class="bookmark-name">{b.name}</span>
          <span class="muted small">{b.url.replace(/^https?:\/\//, '')}</span>
        </button>
        <button class="round small" aria-label="Odebrat {b.name}" onclick={() => remove(i)}><Icon name="close" size={16} /></button>
      </div>
    {/each}
  </div>
  <form class="search-form" onsubmit={(e) => { e.preventDefault(); add() }}>
    <input class="search-field" bind:value={name} placeholder="Název nové záložky (adresu napište nahoře)" aria-label="Název záložky" />
    <button class="btn" type="submit">Přidat záložku</button>
  </form>
</Page>
