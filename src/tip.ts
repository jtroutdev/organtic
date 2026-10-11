import type { Directive } from "vue";

/**
 * `v-tip`: a short note about a control, shown for the pointer and for keyboard focus alike.
 * `v-tip.clipped` shows it only while the element's own text is cut short.
 *
 * One tooltip serves the whole app. It is a popover, so it sits above an open dialog.
 */
interface Tip {
  text: string;
  clipped: boolean;
  described: string | null;
}

// Long enough that passing over a control on the way elsewhere shows nothing.
const HOVER_DELAY = 500;
const tips = new WeakMap<HTMLElement, Tip>();
let box: HTMLElement | undefined;
let owner: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

const isClipped = (element: HTMLElement) =>
  [element, ...element.querySelectorAll<HTMLElement>("*")].some(
    (node) => node.scrollWidth > node.clientWidth,
  );

function hide() {
  clearTimeout(timer);
  if (!owner) return;
  const tip = tips.get(owner);
  if (tip?.described) owner.setAttribute("aria-describedby", tip.described);
  else owner.removeAttribute("aria-describedby");
  owner = undefined;
  box?.hidePopover();
}

function show(element: HTMLElement) {
  const tip = tips.get(element);
  if (!tip?.text || owner === element || !element.isConnected) return;
  if (tip.clipped && !isClipped(element)) return;
  hide();
  if (!box) {
    box = document.createElement("div");
    box.id = "tip";
    box.className = "tip";
    box.setAttribute("role", "tooltip");
    box.popover = "manual";
  }
  // Inside the dialog when there is one, so it is not made inert along with the page.
  (element.closest("dialog") ?? document.body).append(box);
  box.textContent = tip.text;
  box.showPopover();
  owner = element;
  tip.described = element.getAttribute("aria-describedby");
  element.setAttribute("aria-describedby", "tip");

  // Under the control, or above it when there is no room; never off the window's edge.
  const gap = parseFloat(getComputedStyle(box).getPropertyValue("--space-xs")) || 0;
  const at = element.getBoundingClientRect();
  const size = box.getBoundingClientRect();
  const below = at.bottom + gap;
  const top = below + size.height + gap > innerHeight ? at.top - size.height - gap : below;
  const left = Math.min(Math.max(at.left, gap), innerWidth - size.width - gap);
  box.style.top = `${Math.max(top, gap)}px`;
  box.style.left = `${Math.max(left, gap)}px`;
}

addEventListener("keydown", (event) => event.key === "Escape" && hide());
addEventListener("scroll", hide, true);
addEventListener("resize", hide);

export const vTip: Directive<HTMLElement, string | undefined> = {
  mounted(element, binding) {
    tips.set(element, {
      text: binding.value ?? "",
      clipped: !!binding.modifiers.clipped,
      described: null,
    });
    element.addEventListener("pointerenter", () => {
      clearTimeout(timer);
      timer = setTimeout(() => show(element), HOVER_DELAY);
    });
    element.addEventListener("pointerleave", hide);
    element.addEventListener("pointerdown", hide);
    // Only for focus that arrived by keyboard: a click has the pointer's own tooltip.
    element.addEventListener("focusin", (event) => {
      if ((event.target as Element).matches(":focus-visible")) show(element);
    });
    element.addEventListener("focusout", hide);
  },
  updated(element, binding) {
    const tip = tips.get(element);
    if (!tip) return;
    tip.text = binding.value ?? "";
    if (owner === element && box) box.textContent = tip.text;
  },
  beforeUnmount(element) {
    if (owner === element) hide();
  },
};
