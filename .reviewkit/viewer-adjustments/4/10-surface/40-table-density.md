# The directory table spends its width on the claim

Two things stopped truncating fact titles early. The quick-comment
buttons (Not needed / Simplify / Defer) used to sit invisibly at the
end of every row, reserving ~200px while hidden; on fine-pointer
layouts they now overlay the row's right edge only on hover or focus,
so the title owns the full row. And a title gets a second line before
ellipsizing — a fact title is a claim, and a clipped claim can't be
decided on. Touch layouts keep the always-visible buttons on their own
row, unchanged.
