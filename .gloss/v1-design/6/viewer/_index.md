# The viewer is a rich review surface, thin only on integration

A React single page served by the session, built from well-tested
primitives with ReviewKit's own Ink & Amber theme (see `components/`): nested tree navigation with change
badges, directory views with bulk-decision tables, a ⌘K palette, a `?`
shortcut overlay generated from the live key table, content-keyed seen
tracking (browser-local only), quote-anchored highlights with fuzzy
re-anchoring, and edit/delete/reply on every item. It stays humans-only:
no creation forms, no agent progress, no agent access to its API.
