<script lang="ts">
  import { ICONS, type IconName } from '../lib/icons.ts'

  let { name, size = 24, stroke = 1.8 }: { name: IconName; size?: number; stroke?: number } = $props()
</script>

<svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each ICONS[name] as d (d)}<path {d} />{/each}
</svg>
