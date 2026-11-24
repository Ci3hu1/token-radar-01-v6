// odds.ts — the token-odds model: how likely is a protocol to issue a token?
//
// A logistic regression on three features the snapshot itself carries:
//   log10(TVL), age in years since DefiLlama began tracking it, and the 7-day TVL change.
// It is fitted on the eligible peers: protocols that record a listing date and a 7-day
// change, outside the six wrapped / staked / bridged / CEX categories, with the single
// extreme 7-day move (|change| > 200%) set aside. Features are standardised by the
// peers' own mean and standard deviation, so the coefficients below are standardised
// weights. A protocol with no listing date takes the peers' median age; one with no
// 7-day change takes the peers' mean change. The coefficients are the fitted values
// (see NOTES.md for the fit and the validation); they reproduce the reference board.
//
// The odds are a probability, not a prediction: they say how often a protocol like
// this one has a token, not whether or when this one will.

import { ageYears, type Proto } from './snapshot.ts';

/** Categories that are a wrapped, staked or bridged product, or an exchange: not peers. */
export const PEER_EXCLUDE = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** The largest |7-day change| a peer may carry; the one move beyond it is an outlier. */
export const GROWTH_CAP = 200;

/** The eligible peers the odds are fitted on. */
export function peers(protos: Proto[]): Proto[] {
  return protos.filter(
    (p) =>
      p.listed_at !== null &&
      p.change_7d !== null &&
      !PEER_EXCLUDE.has(p.category ?? '') &&
      Math.abs(p.change_7d) <= GROWTH_CAP,
  );
}

/** The peers' feature standardisation, and the imputation values for missing features. */
export interface PeerStats {
  means: [number, number, number];
  sds: [number, number, number];
  medianAge: number;
  meanGrowth: number;
  n: number;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs: number[], m: number): number {
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
}

export function peerStats(peersList: Proto[], asOf: string): PeerStats {
  const feats = peersList.map((p) => {
    const a = ageYears(p, asOf) as number;
    return [Math.log10(p.tvl_usd), a, p.change_7d as number] as [number, number, number];
  });
  const means: [number, number, number] = [mean(feats.map((f) => f[0])), mean(feats.map((f) => f[1])), mean(feats.map((f) => f[2]))];
  const sds: [number, number, number] = [sd(feats.map((f) => f[0]), means[0]), sd(feats.map((f) => f[1]), means[1]), sd(feats.map((f) => f[2]), means[2])];
  const ages = feats.map((f) => f[1]).sort((a, b) => a - b);
  const medianAge = ages[Math.floor(ages.length / 2)];
  return { means, sds, medianAge, meanGrowth: means[2], n: peersList.length };
}

/**
 * The fitted logistic coefficients (standardised weights), in feature order
 * [intercept, log10 TVL, age in years, 7-day change %].
 * Fitted on the 449 eligible peers; see NOTES.md for the fit, the validation
 * (Brier, calibration, blind holdout) and what was tried and dropped.
 */
export const ODDS = {
  bias: 0.28538,
  logTvl: 0.3438,
  age: 0.89006,
  growth: -0.44082,
} as const;

/** A protocol's features, standardised by the peers, with median-age / mean-growth imputation. */
export function features(p: Proto, stats: PeerStats, asOf: string): [number, number, number] {
  const a = ageYears(p, asOf);
  const age = a === null ? stats.medianAge : a;
  const chg = p.change_7d === null ? stats.meanGrowth : p.change_7d;
  const raw: [number, number, number] = [Math.log10(p.tvl_usd), age, chg];
  return [
    (raw[0] - stats.means[0]) / stats.sds[0],
    (raw[1] - stats.means[1]) / stats.sds[1],
    (raw[2] - stats.means[2]) / stats.sds[2],
  ];
}

/** P(token): the logistic probability that a protocol like this one issues a token. */
export function tokenProb(p: Proto, stats: PeerStats, asOf: string): number {
  const z = features(p, stats, asOf);
  const logit = ODDS.bias + ODDS.logTvl * z[0] + ODDS.age * z[1] + ODDS.growth * z[2];
  return 1 / (1 + Math.exp(-logit));
}

/** The logistic probability from standardised features and a weight set (for refits). */
export function probWith(
  z: [number, number, number],
  w: { bias: number; logTvl: number; age: number; growth: number },
): number {
  const logit = w.bias + w.logTvl * z[0] + w.age * z[1] + w.growth * z[2];
  return 1 / (1 + Math.exp(-logit));
}

/**
 * Refit the logistic regression on the peers by iteratively reweighted least squares
 * (Newton-Raphson on the standardised features). A reference fitter: the board uses
 * the ODDS constants above, and the tests check the refit lands near them, so the
 * constants are a fit, not a guess.
 */
export function fitOdds(peersList: Proto[], asOf: string): { bias: number; logTvl: number; age: number; growth: number } {
  const stats = peerStats(peersList, asOf);
  const X: number[][] = [];
  const y: number[] = [];
  for (const p of peersList) {
    const z = features(p, stats, asOf);
    X.push([1, z[0], z[1], z[2]]);
    y.push(p.symbol !== null ? 1 : 0);
  }
  const k = 4;
  const base = y.reduce((a, b) => a + b, 0) / y.length;
  let beta = [Math.log(base / (1 - base)), 0, 0, 0];
  for (let iter = 0; iter < 300; iter++) {
    const g = [0, 0, 0, 0];
    const H: number[][] = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < X.length; i++) {
      const xi = X[i];
      const z = beta[0] * xi[0] + beta[1] * xi[1] + beta[2] * xi[2] + beta[3] * xi[3];
      const pr = 1 / (1 + Math.exp(-z));
      const w = pr * (1 - pr);
      for (let a = 0; a < k; a++) {
        g[a] += (y[i] - pr) * xi[a];
        for (let b = 0; b < k; b++) H[a][b] += w * xi[a] * xi[b];
      }
    }
    // Solve H * delta = g by Gauss-Jordan.
    const A = H.map((row, i) => [...row, g[i]]);
    for (let col = 0; col < k; col++) {
      let piv = col;
      for (let r = col + 1; r < k; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      const tmp = A[col];
      A[col] = A[piv];
      A[piv] = tmp;
      const pv = A[col][col];
      for (let r = 0; r < k; r++) {
        if (r !== col && A[r][col] !== 0) {
          const f = A[r][col] / pv;
          for (let c = col; c <= k; c++) A[r][c] -= f * A[col][c];
        }
      }
    }
    const delta = A.map((row, i) => row[k] / row[i]);
    beta = beta.map((b, i) => b + delta[i]);
    if (Math.max(...delta.map(Math.abs)) < 1e-12) break;
  }
  return { bias: beta[0], logTvl: beta[1], age: beta[2], growth: beta[3] };
}
