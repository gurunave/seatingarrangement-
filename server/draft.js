// Tiers, pick order, and the draft.
//
// Score sets your tier; order *within* your tier is random. That's the whole
// fairness design: being quick at arithmetic earns you more to choose from, but
// never guarantees you pick first, so the same fast people don't take the best
// desk every quarter.

export const TIER_COUNT = 4;
export const OPTIONS_BY_TIER = [4, 3, 2, 2];   // tier 1 sees four desks, tier 4 sees two
export const DRAFT_SECONDS = Number(process.env.DRAFT_SECONDS) || 15;
export const MAX_AUTO_TAIL = 3;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Split n people into four groups as evenly as possible, remainder to the top
// tiers. 20 → 5/5/5/5; 18 → 5/5/4/4; 6 → 2/2/1/1.
export function tierSizes(n) {
  const base = Math.floor(n / TIER_COUNT);
  const extra = n % TIER_COUNT;
  return Array.from({ length: TIER_COUNT }, (_, i) => base + (i < extra ? 1 : 0))
    .filter(size => size > 0);
}

// `results` must already be ranked (score, then time).
export function buildTiers(results) {
  const tiers = [];
  let cursor = 0;
  tierSizes(results.length).forEach((size, i) => {
    const members = results.slice(cursor, cursor + size);
    cursor += size;
    tiers.push({
      tier: i + 1,
      options: OPTIONS_BY_TIER[i] ?? OPTIONS_BY_TIER.at(-1),
      // The luck layer: rank gets you into the tier, chance orders you inside it.
      players: shuffle(members).map(m => ({ id: m.id, name: m.name, rank: m.rank }))
    });
  });
  return tiers;
}

export const draftOrder = tiers =>
  tiers.flatMap(t => t.players.map(p => ({ id: p.id, name: p.name, tier: t.tier, options: t.options })));

// How many pickers at the end get assigned without a choice. With as many
// desks as people the last three have nothing to decide, so the ceremony is
// dropped — but every spare desk hands one of them a real choice back.
export function autoTailCount(seatCount, playerCount) {
  const slack = seatCount - playerCount;
  return Math.max(0, Math.min(MAX_AUTO_TAIL, MAX_AUTO_TAIL - slack, playerCount));
}

export function sampleDesks(deskIds, count) {
  return shuffle(deskIds).slice(0, Math.max(0, Math.min(count, deskIds.length)));
}
