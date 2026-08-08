# Collisions are handled by retrying up to ten times

`freshSlug` draws random slugs against a point-in-time copy of the links
map and throws after 10 collisions (`src/slug.js`). The check is not
transactional with the insert: a slug verified free can be taken by a
concurrent writer before `addLink` persists it.
