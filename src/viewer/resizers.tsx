import * as React from "react";
import { useRef, useState } from "react";
import { type Prefs, getPrefs, setPref, subscribePrefs } from "./prefs.js";

// Desktop drag handles beside the tree and the panel. Each owns one width
// variable on the root, saved as a preference when the drag ends;
// double-click resets to the stylesheet default.
type WidthKey = "panelWidth" | "treeWidth";
const PROP: Record<WidthKey, "--panel-w" | "--tree-w"> = { panelWidth: "--panel-w", treeWidth: "--tree-w" };

function applyWidths(prefs: Prefs): void {
  for (const key of Object.keys(PROP) as WidthKey[]) {
    const width = prefs[key];
    if (width) document.documentElement.style.setProperty(PROP[key], `${width}px`);
    else document.documentElement.style.removeProperty(PROP[key]);
  }
}
applyWidths(getPrefs());
subscribePrefs(() => applyWidths(getPrefs()));

function ColResizer(props: {
  id: string;
  label: string;
  pref: WidthKey;
  widthAt: (clientX: number) => number;
  min: number;
  max: () => number;
}): React.JSX.Element {
  const [active, setActive] = useState(false);
  const width = useRef<number | null>(null);
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
        width.current = Math.round(Math.min(Math.max(props.widthAt(e.clientX), props.min), props.max()));
        document.documentElement.style.setProperty(PROP[props.pref], `${width.current}px`);
      }}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setActive(false);
        // saved once, when the drag ends, not on every frame of it
        if (width.current !== null) setPref(props.pref, width.current);
        width.current = null;
      }}
      onDoubleClick={() => setPref(props.pref, undefined)}
    />
  );
}

export const PanelResizer = (): React.JSX.Element => (
  <ColResizer
    id="panel-resizer"
    label="Resize review panel"
    pref="panelWidth"
    widthAt={(x) => window.innerWidth - x}
    min={240}
    max={() => Math.min(640, window.innerWidth * 0.5)}
  />
);

export const TreeResizer = (): React.JSX.Element => (
  <ColResizer
    id="tree-resizer"
    label="Resize fact tree"
    pref="treeWidth"
    widthAt={(x) => x}
    min={240}
    max={() => Math.min(520, window.innerWidth * 0.5)}
  />
);
