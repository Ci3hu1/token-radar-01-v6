// value.ts — the implied-value curve: what a protocol's token would be worth if it
// launched at the multiple its traded peers trade at.
//
// The curve is fitted from the snapshot itself at run time. The anchors are the protocols
// whose token already trades (a market cap is recorded). Three ingredients, all fitted:
//   1. a log-log OLS line of market cap on TVL over the anchors,
//   2. a per-category multiplier (the shrunken median log-residual of the line in that category),
//   3. a flat multiple (the median market-cap-to-TVL ratio over the anchors).
// The implied market cap blends the curve (with its category multiplier) and the flat multiple
// so neither a thin category nor a single outlier drives the number.

import type { Proto } from './snapshot.ts';

/** The fitted log-log line. */
export interface Curve {
  intercept: number;
  slope: number;
  r2: number;
  n: number;
  residSd: number;
}

/** Protocols whose token already trades: the anchors the curve is fitted on. */
export function anchors(protos: Proto[]): Proto[] {
  return protos.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length;
  return m % 2 === 1 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2;
}

/** OLS of log10(mcap) on log10(TVL) over the anchors. */
export function fitCurve(anchorsList: Proto[]): Curve {
  const xs = anchorsList.map((p) => Math.log10(p.tvl_usd));
  const ys = anchorsList.map((p) => Math.log10(p.mcap_usd as number));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = (sxy * sxy) / (sxx * syy);
  let rss = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (intercept + slope * xs[i]);
    rss += r * r;
  }
  const residSd = Math.sqrt(rss / (n - 2));
  return { intercept, slope, r2, n, residSd };
}

/** The curve's market cap for a protocol at its TVL. */
export function curveVal(p: Proto, curve: Curve): number {
  return Math.pow(10, curve.intercept + curve.slope * Math.log10(p.tvl_usd));
}

/**
 * Per-category multipliers. For each category, the median log-residual of the curve over
 * that category's anchors, shrunk toward 1 by n/(n+3) and clamped to 0.30x–3.00x.
 * A category with no anchors gets 1.0.
 */
export function catMults(anchorsList: Proto[], curve: Curve): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of anchorsList) {
    const cat = p.category ?? 'Uncategorized';
    const resid = Math.log10(p.mcap_usd as number) - (curve.intercept + curve.slope * Math.log10(p.tvl_usd));
    const arr = byCat.get(cat);
    if (arr) arr.push(resid);
    else byCat.set(cat, [resid]);
  }
  const out = new Map<string, number>();
  for (const [cat, rs] of byCat) {
    const med = median(rs);
    const shrunk = Math.pow(10, med * (rs.length / (rs.length + 3)));
    out.set(cat, Math.max(0.3, Math.min(3.0, shrunk)));
  }
  return out;
}

/** The flat multiple: the median market-cap-to-TVL ratio over the anchors. */
export function flatMult(anchorsList: Proto[]): number {
  return median(anchorsList.map((p) => (p.mcap_usd as number) / p.tvl_usd));
}

/** The flat multiple's market cap for a protocol at its TVL. */
export function flatVal(p: Proto, flat: number): number {
  return flat * p.tvl_usd;
}

/**
 * The blended implied market cap. `blend` is the flat multiple's weight (0.28 here):
 * the curve (with its category multiplier) carries 1-blend, the flat multiple blend.
 */
export function blendVal(p: Proto, curve: Curve, mults: Map<string, number>, flat: number, blend: number): number {
  const cat = mults.get(p.category ?? 'Uncategorized') ?? 1.0;
  const curvePart = curveVal(p, curve) * cat;
  const flatPart = flatVal(p, flat);
  return Math.pow(curvePart, 1 - blend) * Math.pow(flatPart, blend);
}

/** The blend weight: how much of the implied value comes from the flat multiple. */
export const BLEND = 0.28;
