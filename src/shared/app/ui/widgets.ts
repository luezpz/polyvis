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

/** A labelled non-negative number field; `title` becomes the tooltip, `step` the input step. */
export function numberField(label: string, value: number, onChange: (v: number) => void, title?: string, step = 0.5): HTMLElement {
  return h("label", { class: "field", ...(title ? { title } : {}) }, h("span", {}, label), numberInput(value, onChange, 0, step));
}

/** A labelled `<select>` over string `values`, calling `onChange(value)`; `title` becomes the tooltip. */
export function selectField<T extends string>(label: string, values: readonly T[], value: T, onChange: (v: T) => void, title?: string): HTMLElement {
  const select = h("select", { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as T) },
    ...values.map((v) => h("option", { value: v, selected: v === value }, v)));
  return h("label", { class: "field", ...(title ? { title } : {}) }, h("span", {}, label), select);
}

/**
 * A `<select>` over a level catalog; option values are indices into `levels`. Entries with a
 * `group` are placed in an `<optgroup>` of that name (in first-seen order), ungrouped ones first.
 */
export function levelSelect(levels: readonly { name: string; description: string; group?: string }[]): HTMLSelectElement {
  const select = h("select", {});
  const groups = new Map<string, HTMLOptGroupElement>();
  levels.forEach((s, i) => {
    const option = h("option", { value: i, title: s.description }, s.name);
    if (!s.group) { select.append(option); return; }
    let g = groups.get(s.group);
    if (!g) { g = h("optgroup", { label: s.group }); groups.set(s.group, g); select.append(g); }
    g.append(option);
  });
  return select;
}

/**
 * A labelled text field for a door brush's name (phase 4b); `onChange(name)` fires on commit (change
 * event) with the trimmed, non-empty name. Brushes sharing a name open and close together.
 */
export function doorNameInput(value: string, onChange: (name: string) => void): HTMLElement {
  const input = h("input", { type: "text", value, onchange: (e: Event) => {
    const name = (e.target as HTMLInputElement).value.trim();
    if (name) onChange(name);
  } });
  return h("label", { class: "field", title: "Brushes with the same door name form one door" }, h("span", {}, "Door name"), input);
}

/** Bias of the BSP's default hint preset (matches the OBJ `hint` material, `OBJ_HINT_BIAS`). */
const HINT_PRESET = -1000;

/**
 * Split-bias editor for one face / edge (phase 3d hint faces): a number field plus Hint / Avoid / Clear presets.
 * `label` names the face (e.g. "Face 3"); `bias` is its current value; `onChange(bias)` sets it
 * (negative = preferred BSP splitter, positive = avoided, 0 = plain).
 */
export function splitBiasField(label: string, bias: number, onChange: (bias: number) => void): HTMLElement {
  const title = "BSP splitter bias, added to the splitter score: negative prefers this plane as a splitter (hint), positive avoids it";
  return h("div", {},
    h("label", { class: "field", title }, h("span", {}, `${label} split bias`), numberInput(bias, onChange, -Infinity, 1)),
    h("div", { class: "button-row" },
      h("button", { onclick: () => onChange(HINT_PRESET), title: `Bias ${HINT_PRESET}: split along this face first` }, "Hint"),
      h("button", { onclick: () => onChange(-HINT_PRESET), title: `Bias ${-HINT_PRESET}: avoid splitting along this face` }, "Avoid"),
      h("button", { onclick: () => onChange(0), disabled: bias === 0 }, "Clear"),
    ),
  );
}
