<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: "default" | "primary" | "quiet";
    type?: "button" | "submit";
    /** A plus sign before the label, for a button that adds something. */
    icon?: "plus";
    /** Stops responding but keeps its look, e.g. while an action runs. */
    disabled?: boolean;
    /** Off for a reason of its own: dimmed, and stays dimmed while an action runs. */
    unavailable?: boolean;
  }>(),
  { variant: "default", type: "button" },
);
</script>

<template>
  <button
    class="btn"
    :class="[variant === 'default' ? '' : variant, { off: unavailable }]"
    :type="type"
    :disabled="disabled || unavailable"
  >
    <svg
      v-if="icon === 'plus'"
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    >
      <path d="M8 3v10M3 8h10" /></svg
    ><slot />
  </button>
</template>

<style scoped>
/* Every control shares one height. Hover and pressed lay a state layer over the control, so it
   lifts whatever it sits on; only the primary button has fills of its own for them. */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-nested);height:var(--size-control);border:1px solid var(--color-outline);background:var(--color-surface-raised);border-radius:var(--radius-md);padding:0 var(--space-md);font:var(--font-label-lg);white-space:nowrap}
.btn:hover:enabled{border-color:var(--color-on-surface-muted);background-image:linear-gradient(var(--color-hover) 0 0)}
.btn:active:enabled{background-image:linear-gradient(var(--color-pressed) 0 0)}
.btn.primary{background:var(--color-primary);border-color:var(--color-primary);color:var(--color-on-primary)}
.btn.primary:hover:enabled{background:var(--color-primary-hover);border-color:var(--color-primary-hover)}
.btn.primary:active:enabled{background:var(--color-primary-pressed);border-color:var(--color-primary-pressed)}
.btn.quiet{border-color:transparent;background-color:transparent;color:var(--color-on-surface-muted);padding-inline:var(--space-sm)}
.btn.quiet:hover:enabled{border-color:transparent;color:var(--color-on-surface)}
.btn.quiet:active:enabled{color:var(--color-on-surface)}
/* The stylesheet's rule for a running action puts this back while one runs, unless the button is `.off`. */
.btn:disabled{opacity:var(--opacity-disabled);cursor:not-allowed}
</style>
