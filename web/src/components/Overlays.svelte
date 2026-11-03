<script lang="ts">
  import { ui } from '../lib/toast.svelte.ts'
</script>

<div class="toast" class:show={!!ui.toast} role="status">{ui.toast?.text}</div>
<div class="notices">
  {#each ui.notices as n (n.id)}
    <div class="notice">
      {#if n.image}<img src={n.image} alt="" />{/if}
      <div>
        <div class="notice-title">{n.title}</div>
        {#if n.text}<div class="notice-text">{n.text}</div>{/if}
      </div>
    </div>
  {/each}
</div>
