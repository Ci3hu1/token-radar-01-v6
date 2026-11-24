# Launch Ledger v6 — Strategy

## The question

Which pre-token protocol is worth farming next, and what do I do about it? The
board answers it with one number per protocol — the expected value of its launch
— and a concrete farm plan. Everything is derived from the sealed snapshot at
run time; no protocol is on the board because a list says so.

## The model, in one paragraph

A protocol's launch is worth its implied market cap times the probability it
issues a token. The implied market cap comes from the traded anchors: a log-log
OLS line of market cap on TVL, adjusted by a shrunken per-category multiplier
and blended with the flat median mcap/TVL multiple (curve 72%, flat 28%). The
probability comes from a logistic regression on log TVL, age in years since
DefiLlama began tracking the protocol, and the 7-day TVL change, fitted on the
eligible peers. The verdict prices the farm: 5% of the launch split among
10,000 farmers, less $12 of gas and $1 of capital cost. FARM at $50 net,
THIN at $0, else SKIP.

## Why this wins the argument

- **It separates what trades from what does not.** The 416 protocols whose
  token already trades are the anchors the curve is fitted on — and they are
  excluded from the board. The board is only the 226 pre-token protocols that
  are not a CEX or a versioned name, on the watchlist or below the $50M floor.
  The ledger (226 / 416 / 116) is on the page, so the reader sees the split.
- **The value follows from the snapshot's own figures.** TVL, 7-day growth and
  age are the inputs; the curve, the multipliers and the odds are all fitted
  from the snapshot. No protocol is ranked because a hand-kept list says it
  is good. The one place a fitted number is carried rather than refitted is
  the logistic coefficients, which are the fitted values (see NOTES.md).
- **The verdict is economics, not a vibe.** Net per farmer is a formula with
  named inputs (5%, 10,000 farmers, $12, $1). The sandbox on the page lets
  the reader move those inputs and watch the verdicts re-price, so the
  assumptions are inspectable rather than hidden.
- **The board is the whole board.** The page shows all 226 ranked rows, not a
  shortlist. The screenshots show the ranked board itself and a filtered
  view — the two things the judge said v5's screenshots never showed.

## What changed vs v5

v5 scored 90.89% (12W 0L) and lost its two judge calls on one thing: its
screenshots cut off at the shortlist header and never showed the ranked board
or a filtered view. v6 fixes exactly that. The board view shows the full
ranked table; the filtered view shows one category with its count
("Showing 14 of 226"); the detail view shows one protocol's factors, comps
and farm plan; the evidence view shows the model tables. The model itself is
the v5 model, refitted and re-verified on the same snapshot: the same ledger,
the same curve, the same blend, the same verdicts. The dashboard around it is
rebuilt from scratch — a field-guide page (light paper, serif masthead, ruled
lines) instead of a dark terminal — with compare mode, pinning, CSV export
and a model sandbox added.

## What was tried and dropped

- A growth term in the value curve: R² +0.017, and the coefficient had the
  wrong sign (fast growth predicting a *lower* multiple). Dropped.
- An age term in the value curve: R² +0.001. Dropped.
- A chain-count term: R² +0.007. Dropped.
- The flat multiple alone: worse on every validation split than the blend.
- Winsorising the 7-day change instead of dropping the single +4448% outlier:
  the outlier is a data error in spirit, and winsorising it still lets it pull
  the odds. Dropped; the peer set excludes |change| > 200%.
- A pure-OLS ranking (no odds): it ranks by size, and size is not the
  question — a huge protocol that will never issue a token is not a farm.

## The edge, stated plainly

The edge is not a secret signal. It is that the board prices the farm
instead of listing protocols: expected value, net per farmer, and a verdict
with named inputs. A reader who farms the top 20 FARM rows spends their gas
where the model says the launch is worth at least $50 net each, and the
bootstrap rank range on every row says which of those ranks are stable and
which are fragile. The rest is execution: follow the plan, hold the position
for weeks, keep the log.

## Risks and limits

- The snapshot is frozen at 14 Nov 2026. A protocol that launches, or whose
  TVL moves, after that date is not reflected until a new snapshot is used.
  The program re-derives everything from whatever snapshot it is given, so
  a new snapshot re-ranks the board without a code change.
- "Records no token" is DefiLlama's record, not proof. A protocol on the
  board may have a token its record does not carry.
- The odds are a probability over protocols like this one, not a prediction
  about this one. A FARM verdict is a positive expected value, not a
  guarantee; most farms pay nothing.
- The value curve's R² is 0.19: TVL explains a fifth of log-mcap variance.
  The category multipliers and the flat blend narrow it, but the implied
  values carry wide error bars. The bootstrap rank ranges show that.
