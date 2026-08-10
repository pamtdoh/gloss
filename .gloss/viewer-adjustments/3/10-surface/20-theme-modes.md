# Theme is one button: sun flips to moon

The header button toggles light and dark — no menu (owner: "just a
simple toggle is good enough"). Until first touched, the viewer
follows the OS; the toggle then persists the explicit choice in
`localStorage` (`rk-theme`), applied before React mounts so the first
paint is already right. "Theme: system" survives as a ⌘K palette
command for handing control back to the OS.
