# Changed means everything that moved — including what was deleted

The changed set is computed the ReviewKit way, by plain text comparison
against the previous snapshot's standalone copy: content differs →
changed, path absent from the previous snapshot → new, and path absent
from the *current* snapshot → removed. Removed facts appear in the
Changed scope as ghost rows resurrected from the previous copy — a
deletion is the agent's most drastic resolution of a comment, and it
should be reviewable, not invisible. No fingerprints are stored
anywhere; `prev` is just the previous snapshot fetched at load.
