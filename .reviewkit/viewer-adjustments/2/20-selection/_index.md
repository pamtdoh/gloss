# Selection actions follow the pointer, not one bar for all

Selecting text offers Comment and Ask, but where those actions appear
now depends on the input device, decided once per session by
`(pointer: coarse)`. Fine pointers get a bubble at the selection; touch
keeps the fixed bottom bar. One capture pipeline feeds both — the
selected span persists as state and paints via `::highlight(rk-pending)`
either way.
