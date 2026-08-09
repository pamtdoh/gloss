# Review state is one JSON sidecar per fact, holding only items

Everything the human raises about a fact lives in `<fact>.review.json`
as a flat list of items — comments (anchored to a quote or covering the
whole fact) and questions with human/agent threads. There is no
decision field: the old decisions are one-tap "quick comment" presets.
Anchors are W3C TextQuoteSelector triples: the verbatim quote plus
optional prefix/suffix.
