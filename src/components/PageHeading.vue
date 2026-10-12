<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<!-- A page's heading and one line about it, with the page's own actions on the right. -->
<template>
  <div class="head">
    <div>
      <h1>{{ title }}</h1>
      <p><slot /></p>
    </div>
    <slot name="actions" />
  </div>
</template>

<style scoped>
.head{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:var(--space-surface)}
.head>div:first-child{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-dense) var(--space-nested)}
.head p{color:var(--color-on-surface-muted)}
</style>
