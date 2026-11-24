// plan.ts — the farm plan: concrete steps to farm a protocol before (or after) it
// issues a token. Every step names what to do, what it costs and how long it takes;
// nothing here is a slogan. Steps are built from the protocol's own record — its
// category, its chains and its size — so a Lending plan reads like Lending and a
// bridge plan reads like a bridge, and no two protocols share a plan word for word.

import type { Proto } from './snapshot.ts';

/** The chain a plan is written for: the protocol's first listed chain, or Ethereum. */
function homeChain(p: Proto): string {
  return p.chains && p.chains.length > 0 ? p.chains[0] : 'Ethereum';
}

/** A dollar figure for a step, scaled to the protocol's size so small farms stay cheap. */
function ticket(p: Proto): string {
  if (p.tvl_usd >= 500_000_000) return '$500–$2,000';
  if (p.tvl_usd >= 100_000_000) return '$200–$1,000';
  return '$50–$300';
}

function gasNote(p: Proto): string {
  const chain = homeChain(p);
  if (chain === 'Ethereum') return 'Budget $5–$25 per transaction in gas on Ethereum mainnet; batch steps when the network is quiet (weekends, UTC night).';
  if (chain === 'Solana') return 'Solana fees are fractions of a cent; the cost here is the capital you commit, not gas.';
  return `Gas on ${chain} is usually under $1 per transaction; the cost here is the capital you commit.`;
}

/** Steps shared by every plan: research, wallet, first touch. */
function openSteps(p: Proto): string[] {
  return [
    `Read ${p.name}'s docs and confirm it records no token yet (its DefiLlama page lists no symbol). Spend 30 minutes; do not deposit before you know what the protocol does.`,
    `Set up a fresh wallet on ${homeChain(p)} and fund it with ${ticket(p)} plus gas. Keep this wallet separate from your main holdings so the farm's trail is clean.`,
    gasNote(p),
  ];
}

/** Steps shaped by the protocol's category. */
function middleSteps(p: Proto): string[] {
  const cat = p.category ?? 'Uncategorized';
  const chain = homeChain(p);
  const t = ticket(p);
  switch (cat) {
    case 'Lending':
      return [
        `Supply ${t} of a stablecoin or blue-chip asset to ${p.name}'s lending market on ${chain}. Hold the position at least 4 weeks; airdrops reward duration, not a single deposit.`,
        `Borrow a small amount (under 30% of your collateral) against the supply and repay it a week later. Two borrow-repay cycles show real use; never borrow near the liquidation line.`,
        `If ${p.name} has a points or rewards tab, opt in and check it weekly. Screenshot your supplied balance each week so you can prove the position later.`,
      ];
    case 'Dexs':
      return [
        `Swap ${t} through ${p.name} on ${chain} in 3–5 trades spread over 2 weeks, using different pairs when they exist. Small, spaced trades count more than one large swap.`,
        `Add ${t} to a ${p.name} liquidity pool for at least 3 weeks. Prefer a stable pair if one exists; if you provide a volatile pair, keep the position small.`,
        `If ${p.name} routes through an aggregator, run one trade a week through its own interface instead, so the volume is attributed to the protocol.`,
      ];
    case 'Bridge':
    case 'Canonical Bridge':
      return [
        `Bridge ${t} into ${chain} through ${p.name}, then bridge a smaller amount back a week later. Two-way flow over 2–3 weeks reads as a user, not a one-off.`,
        `Repeat the bridge once a month with a different asset. Keep each crossing above $50 so it is not filtered as dust.`,
        `Hold the bridged asset on the destination chain for a few days before moving it on; instant round-trips are the pattern sybil filters look for.`,
      ];
    case 'Liquid Staking':
    case 'Liquid Restaking':
    case 'Restaked BTC':
      return [
        `Stake ${t} through ${p.name} on ${chain} and hold the receipt token for at least a month. Restaking rewards accrue to holders, not to quick exits.`,
        `Use the receipt token once in a DeFi position (a lending market or a DEX pool) to show the receipt is in circulation, then return it. One use is enough.`,
        `Check ${p.name}'s validator or operator set before staking; prefer an operator with a public track record over the highest advertised yield.`,
      ];
    case 'Derivatives':
    case 'Perps':
      return [
        `Open a small perpetual position on ${p.name} (${t} of margin, 2x leverage at most) and close it after a few days. Keep the position size small; the point is activity, not PnL.`,
        `Place one limit order and one market order in separate weeks. A limit order that fills shows you use the order book, not just market takes.`,
        `Never hold a leveraged position through a volatile event while farming; close positions before major announcements and reopen after.`,
      ];
    case 'Yield':
    case 'Yield Aggregator':
      return [
        `Deposit ${t} into a ${p.name} vault on ${chain} and leave it for 4–6 weeks. Vaults reward time in the vault; withdrawing weekly resets the clock.`,
        `Harvest or compound the vault's yield once, then leave the position alone. One harvest proves the loop works; frequent harvesting wastes gas.`,
        `Compare the vault's strategy in its docs before depositing; if you cannot explain where the yield comes from in one sentence, pick another vault.`,
      ];
    case 'CDP':
      return [
        `Open a collateralised debt position on ${p.name} with ${t} of collateral and mint a modest amount of its stable asset (under 40% of the collateral value).`,
        `Repay part of the debt after two weeks, then mint again. A borrow-repay cycle over a month shows sustained use of the CDP.`,
        `Keep the collateral ratio above 200% at all times; a liquidation during a farm wipes out the position and the airdrop case with it.`,
      ];
    case 'RWA':
      return [
        `Buy ${t} of ${p.name}'s tokenised asset on ${chain} and hold it for at least a month. RWA farms reward holding the real-world claim, not flipping it.`,
        `If ${p.name} pays a yield on the asset, claim it once and restake or hold the proceeds; one claim proves the loop.`,
        `Check the asset's backing and custodian in ${p.name}'s docs before buying; an RWA you cannot verify is not a farm, it is a gamble.`,
      ];
    case 'Chain':
      return [
        `Bridge ${t} to ${p.name}'s chain and use a native app there within the same week — a swap, a lend or a mint — so the chain sees a user, not just a bridge deposit.`,
        `Make one transaction a week on the chain for a month (a swap, a vote, a small NFT mint). Regular activity over weeks beats a single burst.`,
        `Hold a small balance of the chain's gas token for the whole month; an empty wallet at snapshot time is the easiest way to be filtered out.`,
      ];
    case 'Gaming':
      return [
        `Play ${p.name} for 30–60 minutes a week for a month and complete its weekly quest or mission when one exists. Gaming farms reward playtime, not wallet size.`,
        `Buy or craft one in-game item with ${t} and use it in play; holding an item you never use is a weaker signal than using it.`,
        `Join ${p.name}'s community channel and read the announcements weekly; quest rules change, and a missed quest is a missed multiplier.`,
      ];
    case 'NFT Marketplace':
    case 'NFT Lending':
      return [
        `List or buy one NFT on ${p.name} with ${t} and hold it for at least 2 weeks. One real trade beats ten wash trades, which filters catch.`,
        `Make one offer on a collection you would actually own, at a price you would pay. A serious offer is a stronger signal than a lowball.`,
        `If ${p.name} has a creator or curation feature, use it once; marketplaces reward participants, not just buyers.`,
      ];
    default:
      return [
        `Use ${p.name} on ${chain} with ${t} in its core action — the thing its docs describe first — once a week for a month. Four weekly uses beat one large deposit.`,
        `Leave the position open for at least 3 weeks. Airdrops snapshot duration; a deposit withdrawn the next day is usually worth nothing.`,
        `Check ${p.name}'s docs for a points, quests or rewards page and opt in if one exists; if there is none, your on-chain trail is the record.`,
      ];
  }
}

/** Steps shared by every plan: close out, record, stay safe. */
function closeSteps(p: Proto): string[] {
  return [
    `Keep a simple log: dates, amounts and transaction hashes for every ${p.name} action. If a claim form asks for proof, this log is what you submit.`,
    `Never pay anyone to "claim" an airdrop for you and never sign a transaction you did not initiate. Real claims happen on the protocol's own site, after it announces them.`,
  ];
}

/** The farm plan for one protocol: 5–7 concrete steps, each 20–600 characters. */
export function farmPlan(p: Proto): string[] {
  const steps = [...openSteps(p), ...middleSteps(p), ...closeSteps(p)];
  return steps.map((s) => (s.length > 600 ? s.slice(0, 597) + '...' : s));
}
