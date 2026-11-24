/**
 * Shared-element arrival (ONTO): what to fade and what not to clip around a <Morph>
 * that flies into a newly mounted page or view.
 *
 * Done once in JS, as attributes, instead of `:has()` selectors: a `:has()` in the
 * subject of a CSS rule is checked for every element on every style recalc, which
 * showed up as 30–50 ms of style work inside route transitions.
 *
 *   data-morph-fade    each branch beside the path from the root to a morph target:
 *                      fades in once the outgoing page has left (globals.css)
 *   data-morph-unclip  a morph target's direct parent: no clipping while it flies
 *                      (a truncating title would otherwise hide the name in flight)
 */

/** The [data-morph] elements under `root` that one of the `others` also has. */
export function sharedMorphTargets(root: HTMLElement, others: Element[]): HTMLElement[] {
  if (!others.length) return [];
  return [...root.querySelectorAll<HTMLElement>("[data-morph]")].filter((t) =>
    others.some((o) => o.querySelector(`[data-morph="${CSS.escape(t.dataset.morph ?? "")}"]`)),
  );
}

/** Tag the arrival around `targets`; returns a function that removes the tags. */
export function tagMorphArrival(root: HTMLElement, targets: HTMLElement[]): () => void {
  const tagged: [Element, string][] = [];
  const tag = (e: Element, name: string) => {
    if (e.hasAttribute(name)) return;
    e.setAttribute(name, "");
    tagged.push([e, name]);
  };
  for (const t of targets) {
    if (t.parentElement && t.parentElement !== root) tag(t.parentElement, "data-morph-unclip");
    for (let node: Element = t; node !== root && node.parentElement; node = node.parentElement) {
      for (const sib of node.parentElement.children)
        if (sib !== node && !targets.some((x) => sib.contains(x))) tag(sib, "data-morph-fade");
      if (node.parentElement === root) break;
    }
  }
  return () => tagged.forEach(([e, name]) => e.removeAttribute(name));
}
