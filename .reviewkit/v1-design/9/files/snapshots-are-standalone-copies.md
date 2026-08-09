# Snapshots are standalone copies with no lineage

A review is numbered snapshot directories; each iteration starts as a
plain `cp -r` of the previous snapshot. Nothing links snapshots — no
pointers, no shared data, no lineage metadata. Comparing two snapshots
means diffing directories.
