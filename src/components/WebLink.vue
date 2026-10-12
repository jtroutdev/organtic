<!-- Only for something that opens a web page. -->
<template>
  <button class="link" type="button"><slot /></button>
</template>

<style scoped>
.link{background:none;border:0;padding:var(--space-xs) 0;min-height:var(--size-control-sm);color:var(--color-accent);font:var(--font-body-sm);font-weight:500;text-decoration:underline;text-underline-offset:3px}
.link:hover{text-decoration-thickness:2px}
</style>
