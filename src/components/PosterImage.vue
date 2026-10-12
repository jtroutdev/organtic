<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{
  src?: string;
  /** A reduced size, from a provider whose address for one cannot be worked out. */
  thumb?: string;
  /** Shown in the poster's place when there is none, e.g. "FILM". */
  placeholder?: string;
  /** Loads only once it is near the screen, for a poster in a long strip. */
  lazy?: boolean;
  /** Twice the size, for a dialog. */
  large?: boolean;
}>();
// Posters are shown small. TMDB and TVmaze serve a reduced size at a predictable address.
const small = computed(
  () =>
    props.thumb ??
    props.src
      ?.replace("/t/p/original/", "/t/p/w154/")
      .replace("/original_untouched/", "/medium_portrait/"),
);
// Falls back to the full-size poster once before giving up on it.
const failed = ref(0);
watch(
  () => props.src,
  () => (failed.value = 0),
);
const shown = computed(() => (failed.value ? props.src : small.value));
</script>

<template>
  <img
    v-if="src && (failed === 0 || (failed === 1 && small !== src))"
    class="poster"
    :class="{ large }"
    :src="shown"
    alt=""
    :loading="lazy ? 'lazy' : undefined"
    referrerpolicy="no-referrer"
    @error="failed++"
  />
  <span v-else-if="placeholder" class="poster" :class="{ large }" aria-hidden="true">{{ placeholder }}</span>
</template>

<style scoped>
.poster{width:var(--size-poster);aspect-ratio:2/3;border-radius:var(--radius-sm);object-fit:cover;background:var(--color-surface-raised)}
span.poster{display:grid;place-items:center;font:var(--font-code-sm);letter-spacing:var(--tracking-code);color:var(--color-on-surface-muted)}
.poster.large{width:calc(2 * var(--size-poster));background:var(--color-surface)}
</style>
