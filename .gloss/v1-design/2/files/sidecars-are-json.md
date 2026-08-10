# Review state is one JSON sidecar per fact

Everything the human raises about a fact — decision, annotations,
questions with threads, comments — lives in `<fact>.review.json` next to
it. Facts stay Markdown (prose for humans); sidecars are JSON because the
viewer writes them and the agent reads them. Anchors are exact quotes,
widened until unique within the fact.
