<script setup lang="ts">
import { computed } from "vue";
import { vTip } from "../tip.ts";

const props = defineProps<{
  path: string;
  /** The full path, when `path` is only the end of it. */
  tip?: string;
  /** Mutes the file name along with its folder. */
  muted?: boolean;
}>();
// The folder gives way first when space is short, then the file name.
const parts = computed(() => {
  const at = Math.max(props.path.lastIndexOf("/"), props.path.lastIndexOf("\\")) + 1;
  return [props.path.slice(0, at), props.path.slice(at)];
});
</script>

<template>
  <span v-tip="tip ?? path" class="path" :class="{ muted }"
    ><span class="dir" :class="{ muted: !muted }">{{ parts[0] }}</span
    ><span class="base">{{ parts[1] }}</span></span
  >
</template>

<style scoped>
.path{display:flex;min-width:0;font:var(--font-code-md);font-weight:400;white-space:nowrap}
.path span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dir{flex:0 1000 auto}
.base{flex:0 1 auto}
</style>
