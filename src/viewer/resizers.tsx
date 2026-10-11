import * as React from "react";
import { useState } from "react";

// Desktop drag handles beside the tree and the panel. Each owns one width
// variable on the root; double-click resets to the stylesheet default.
const PANEL_W_KEY = "rk-panel-w";
const TREE_W_KEY = "rk-tree-w";
for (const [key, prop] of [
  [PANEL_W_KEY, "--panel-w"],
  [TREE_W_KEY, "--tree-w"],
] as const) {
  const saved = Number(localStorage.getItem(key));
  if (saved) document.documentElement.style.setProperty(prop, `${saved}px`);
}

function ColResizer(props: {
  id: string;
  label: string;
  prop: "--panel-w" | "--tree-w";
  storageKey: string;
  widthAt: (clientX: number) => number;
  min: number;
  max: () => number;
}): React.JSX.Element {
  const [active, setActive] = useState(false);
  return (
    <button
      className="col-resizer"
      id={props.id}
      aria-orientation="vertical"
      aria-label={`${props.label} (double-click to reset)`}
      title="Drag to resize · double-click resets"
      data-active={active ? "" : undefined}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setActive(true);
      }}
      onPointerMove={(e) => {
        if (!active) return;
        const width = Math.round(Math.min(Math.max(props.widthAt(e.clientX), props.min), props.max()));
        document.documentElement.style.setProperty(props.prop, `${width}px`);
        localStorage.setItem(props.storageKey, String(width));
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setActive(false);
      }}
      onDoubleClick={() => {
        document.documentElement.style.removeProperty(props.prop);
        localStorage.removeItem(props.storageKey);
      }}
    />
  );
}

export const PanelResizer = (): React.JSX.Element => (
  <ColResizer
    id="panel-resizer"
    label="Resize review panel"
    prop="--panel-w"
    storageKey={PANEL_W_KEY}
    widthAt={(x) => window.innerWidth - x}
    min={240}
    max={() => Math.min(640, window.innerWidth * 0.5)}
  />
);

export const TreeResizer = (): React.JSX.Element => (
  <ColResizer
    id="tree-resizer"
    label="Resize fact tree"
    prop="--tree-w"
    storageKey={TREE_W_KEY}
    widthAt={(x) => x}
    min={240}
    max={() => Math.min(520, window.innerWidth * 0.5)}
  />
);
