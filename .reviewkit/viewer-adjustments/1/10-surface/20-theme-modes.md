# Theme is a three-way choice: light, dark, or follow the system

A sun/moon menu in the header offers Light | Dark | System, and the
⌘K palette carries the same three as commands. The choice persists in
`localStorage` (`rk-theme`); System is the default and stores nothing.
The stored mode is applied at module load, before React mounts, so the
first paint is already the right theme — no flash.
