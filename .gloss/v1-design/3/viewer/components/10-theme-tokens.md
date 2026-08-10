# One token layer drives both themes and all motion

Colors, elevation, radii, and motion are single-source tokens ported from
leetcoach: light and dark palettes (dark follows the system preference),
an elevation scale per theme, and a closed motion vocabulary — 20ms
paint-only hovers, 120ms interactions, exits always faster and on the
sharper curve. Every control shares one composable focus ring. Reduced
motion zeroes everything.
