<script setup lang="ts" generic="T extends string">
defineProps<{
  /** A step that is `open` can be gone to; `count` is shown after its label. */
  steps: readonly {
    id: T | null;
    label: string;
    open: boolean;
    count: number | null;
    /** What `count` counts, for screen readers, e.g. " groups in the queue". */
    unit: string;
  }[];
  /** The step the wizard is on, counting from 1. */
  at: number;
  /** Another page is on screen, so the step the wizard is on can be gone back to. */
  away?: boolean;
}>();
defineEmits<{ go: [id: T] }>();
</script>

<!-- A finished or reachable step is a button; the rest are plain text, as is the step on screen. -->
<template>
  <nav class="steps" aria-label="Progress">
    <ol>
      <template v-for="(step, index) in steps" :key="step.label">
        <li v-if="index" class="join" aria-hidden="true"></li>
        <li>
          <component
            :is="step.id && (index + 1 === at ? away : step.open) ? 'button' : 'span'"
            class="step"
            :class="{ done: index + 1 < at, at: index + 1 === at }"
            :type="step.id && (index + 1 === at ? away : step.open) ? 'button' : undefined"
            :aria-current="index + 1 === at && !away ? 'step' : undefined"
            @click="step.id && (index + 1 === at ? away : step.open) && $emit('go', step.id)"
          >
            <span class="badge">
              <svg
                v-if="index + 1 < at"
                aria-hidden="true"
                viewBox="0 0 16 16"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
              <template v-else>{{ index + 1 }}</template>
            </span>
            <span class="sr-only">{{ index + 1 < at ? "Finished: " : "" }}</span
            >{{ step.label
            }}<span v-if="step.count !== null" class="n"
              >{{ step.count }}<span class="sr-only">{{ step.unit }}</span></span
            >
          </component>
        </li>
      </template>
    </ol>
  </nav>
</template>

<style scoped>
.steps ol{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-dense);list-style:none;padding:0}
.join{width:var(--size-badge);height:1px;background:var(--color-outline)}
.step{display:inline-flex;align-items:center;gap:var(--space-nested);height:var(--size-control);padding:0 var(--space-sm);border:0;border-radius:var(--radius-md);background:none;color:var(--color-on-surface-muted);font:var(--font-label-lg);white-space:nowrap}
button.step:hover{color:var(--color-on-surface);background-image:linear-gradient(var(--color-hover) 0 0)}
button.step:active{background-image:linear-gradient(var(--color-pressed) 0 0)}
.step.done,.step.at{color:var(--color-on-surface)}
.step.at{font-weight:600}
.badge{display:inline-grid;place-items:center;flex:none;width:var(--size-badge);height:var(--size-badge);border:1px solid var(--color-outline);border-radius:var(--radius-full);font:var(--font-code-sm)}
.step.done .badge{background:var(--color-success-soft);border-color:transparent;color:var(--color-success)}
.step.at .badge{background:var(--color-primary);border-color:var(--color-primary);color:var(--color-on-primary)}
.n{font:var(--font-code-sm);color:var(--color-on-surface-muted)}
@media (forced-colors:active){
  .step[aria-current]{outline:2px solid Highlight;outline-offset:-2px}
}
</style>
