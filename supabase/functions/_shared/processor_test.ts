// Deno tests untuk algoritma matching murni — tidak menyentuh DB/Telegram.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scoreCandidates, type QueueEntry, type MatchInputs } from "./processor.ts";

function mkCandidate(overrides: Partial<QueueEntry> & { profile_id: string }): QueueEntry {
  return {
    province_code: null,
    gender: null,
    gender_preference: "any",
    is_premium: false,
    joined_at: new Date(0).toISOString(),
    ...overrides,
  };
}

function baseInputs(over: Partial<MatchInputs> = {}): MatchInputs {
  const now = Date.now();
  return {
    requester: {
      id: "me",
      province_code: null,
      gender: null,
      gender_preference: "any",
      is_premium: false,
      trust_score: 100,
      joined_at: new Date(now).toISOString(),
      interests: new Set<string>(),
    },
    candidates: [],
    trustById: new Map(),
    interestsById: new Map(),
    blockedSet: new Set(),
    trustFilter: "any",
    nowMs: now,
    ...over,
  };
}

Deno.test("low-trust requester eventually matches after waiting", () => {
  const now = Date.now();
  const cands = [mkCandidate({ profile_id: "c1", joined_at: new Date(now).toISOString() })];
  const trust = new Map([["c1", 100]]);

  // immediate: trust=20 → high baseThreshold, no wait → no match
  const immediate = scoreCandidates(baseInputs({
    requester: { ...baseInputs().requester, trust_score: 20, joined_at: new Date(now).toISOString() },
    candidates: cands, trustById: trust, nowMs: now,
  }));
  assertEquals(immediate, null, "low-trust without wait should NOT match");

  // after 5 min wait, threshold drops to 0 → must match
  const later = scoreCandidates(baseInputs({
    requester: { ...baseInputs().requester, trust_score: 20, joined_at: new Date(now - 300_000).toISOString() },
    candidates: [mkCandidate({ profile_id: "c1", joined_at: new Date(now - 300_000).toISOString() })],
    trustById: trust, nowMs: now,
  }));
  assert(later !== null, "low-trust after long wait SHOULD match");
});

Deno.test("many candidates: highest score wins, blocked excluded", () => {
  const now = Date.now();
  const cands = ["a","b","c","d","e"].map((id) =>
    mkCandidate({ profile_id: id, province_code: id === "c" ? "ID-JK" : "ID-OTHER" }));
  const res = scoreCandidates(baseInputs({
    requester: {
      ...baseInputs().requester,
      province_code: "ID-JK",
      joined_at: new Date(now).toISOString(),
    },
    candidates: cands,
    trustById: new Map(cands.map((c) => [c.profile_id, 100])),
    blockedSet: new Set(["c"]), // best province match is blocked
    nowMs: now,
  }));
  assert(res !== null);
  assertEquals(res!.entry.profile_id !== "c", true, "blocked candidate must not be picked");
});

Deno.test("extreme trust 0 and 150 still get matched eventually", () => {
  const now = Date.now();
  const cands = [mkCandidate({ profile_id: "p", joined_at: new Date(now - 600_000).toISOString() })];
  const trust = new Map([["p", 100]]);

  const t0 = scoreCandidates(baseInputs({
    requester: { ...baseInputs().requester, trust_score: 0, joined_at: new Date(now - 600_000).toISOString() },
    candidates: cands, trustById: trust, nowMs: now,
  }));
  assert(t0 !== null, "trust=0 with long wait should match");

  const t150 = scoreCandidates(baseInputs({
    requester: { ...baseInputs().requester, trust_score: 150, joined_at: new Date(now).toISOString() },
    candidates: cands, trustById: trust, nowMs: now,
  }));
  assert(t150 !== null, "trust=150 should match instantly");
});

Deno.test("trust filter relaxes after 90s wait", () => {
  const now = Date.now();
  const cands = [mkCandidate({ profile_id: "p", joined_at: new Date(now).toISOString() })];
  const trust = new Map([["p", 50]]); // below "trusted" min (90)

  // immediate with filter "trusted" → no match (trust 50 < 90)
  const immediate = scoreCandidates(baseInputs({
    candidates: cands, trustById: trust, trustFilter: "trusted", nowMs: now,
  }));
  assertEquals(immediate, null);

  // after ~5 min wait → filter relaxed enough to allow trust=50
  const later = scoreCandidates(baseInputs({
    requester: { ...baseInputs().requester, joined_at: new Date(now - 300_000).toISOString() },
    candidates: cands, trustById: trust, trustFilter: "trusted", nowMs: now,
  }));
  assert(later !== null, "filter must be relaxed after long wait (anti-starvation)");
});
