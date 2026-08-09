# Selection actions follow the pointer, not one bar for all

Selecting text offers Comment and Ask, but where those actions appear
depends on the input device, decided once per session by
`(pointer: coarse)`. Fine pointers get an instant bubble at the
selection and lean on the browser's native highlight; touch keeps the
fixed bottom bar and paints its own persistent highlight, because iOS
collapses the native one on any tap. One capture pipeline feeds both.
