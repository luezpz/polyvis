/** Small panel widgets shared by both editors, built on {@link h}. */

import { h } from "./dom";

/** A titled panel section. */
export function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h("section", {}, h("h2", {}, title), ...children);
}

/** A key/value read-out row. */
export function kv(key: string, value: string): HTMLElement {
  return h("div", { class: "kv" }, h("span", { class: "k" }, key), h("span", { class: "v" }, value));
}

/** A labelled checkbox calling `onChange(checked)`. */
export function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h("input", { type: "checkbox", checked, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) });
  return h("label", { class: "check" }, input, label);
}

/** A number input; `onChange` only sees finite values `>= min` (others are ignored). */
export function numberInput(value: number, onChange: (v: number) => void, min = 0, step = 0.5): HTMLInputElement {
  return h("input", {
    type: "number", min, step, value,
    onchange: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(v) && v >= min) onChange(v);
    },
  });
}

/** A labelled non-negative number field; `title` becomes the tooltip. */
export function numberField(label: string, value: number, onChange: (v: number) => void, title?: string): HTMLElement {
  return h("label", { class: "field", ...(title ? { title } : {}) }, h("span", {}, label), numberInput(value, onChange));
}
