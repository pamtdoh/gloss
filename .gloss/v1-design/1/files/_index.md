# Plain files under .reviewkit/ are the entire data model

Facts, decisions, annotations, questions, answers, and approval all live
as ordinary files in the target repo. There is no database, no server-side
state, and no API that owns them: agents and the viewer read and write the
same files, and git history is the audit trail.
