# The tree scopes to All | Changed | Raised

A segmented control in a pinned header under the tree filter, each
segment carrying its live count. All is the whole snapshot; Changed is
what moved since the previous snapshot, deletions included; Raised is
what carries your comments and questions. The design is option A from
the GitHub/GitLab file-filtering research, with the owner's two calls:
a three-way control, and deleted facts visible. `d` cycles the scope,
the palette names all three, and a snapshot switch resets to All —
like the text filter, so a fresh snapshot never starts with facts
silently hidden.
