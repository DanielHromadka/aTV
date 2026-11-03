<script lang="ts">
  import type { FilmDetails } from '../../../shared/release.ts'
  import { nav } from '../lib/router.svelte.ts'

  /** Who plays in the film: round portraits that open the actor's filmography. */
  let { cast }: { cast: FilmDetails['cast'] } = $props()

  let failed = $state<Record<string, boolean>>({})
  const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('')
</script>

<section class="nf-section">
  <h2 class="nf-h2">Hrají</h2>
  <ul class="cast">
    {#each cast as c (c.id)}
      <li>
        <button class="cast-person" onclick={() => nav.push({ name: 'actor', actor: { id: c.id, name: c.name, photo: c.photo, source: 'tmdb', knownFor: c.character } })}>
          <span class="cast-photo">
            {#if c.photo && !failed[c.id]}<img src={c.photo} alt="" loading="lazy" onerror={() => (failed[c.id] = true)} />
            {:else}<span>{initials(c.name)}</span>{/if}
          </span>
          <span class="cast-name">{c.name}</span>
          {#if c.character}<span class="cast-role">{c.character}</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
</section>
