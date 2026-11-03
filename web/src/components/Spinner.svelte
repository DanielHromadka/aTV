<script lang="ts">
  let { label = 'Načítám…' }: { label?: string } = $props()
</script>

<div class="spinner" role="status"><span class="spinner-dot"></span>{label}</div>
