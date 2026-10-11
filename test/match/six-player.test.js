import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { SharedPool } from '../../server/match/pool.js';
import { generateDraft } from '../../server/match/choices.js';
import { createRng } from '../../server/sim/rng.js';
import { compactResult } from '../../server/sim/spec.js';
import { MAX_SEATS, PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { normalizeSp } from '../../public/js/ui/gameLogic.js';

test('six players: pool capacity rounds up and boss HP grows above four players', () => {
  assert.equal(MAX_SEATS, 6);
  const gd = new GameData(DATA, 'mode_multi_hard');
  const pool = new SharedPool(gd, { playerCount: 6 });
  for (const [id, e] of pool.entries) assert.equal(e.cap, Math.ceil(gd.poolCopies(id) * 1.5));
  assert.equal(gd.bossPoolShare(6), gd.bossPoolShare(4) * 1.5);
});

test('six players: all bounty stages offer eight distinct cards and all players can pick', () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  for (const round of [3, 9, 11]) {
    for (let seed = 1; seed <= 40; seed++) {
      const draft = generateDraft(gd, createRng(seed), round, { playerCount: 6 });
      assert.equal(draft.cards.length, 8);
      if (draft.family === 'bounty') assert.equal(new Set(draft.cards.map(c => c.id)).size, 8);
    }
  }
  const h = makeMatch({ humans: 6, difficulty: 'HARD', fake: true });
  h.m.round = 3;
  h.m.enterSpDraft();
  assert.equal(h.m.sp.cards.length, 8);
  for (let idx = 0; idx < 6; idx++) {
    const ps = h.m.players.get(h.m.spTurn());
    assert.deepEqual(h.m.pickCard(ps, idx), { ok: true });
  }
  h.sched.advance(1);
  assert.equal(h.m.phase, PHASE.PREP);
  h.m.dispose();
});

test('battle result compaction preserves every player in a six-player field', () => {
  const perPlayer = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p_${i}`, { total: 1, killed: 1, leaked: [] }]));
  assert.equal(Object.keys(compactResult({ perPlayer }).perPlayer).length, 6);
});

test('one human with five AI receives all eight supply choices through client normalization', () => {
  const h = makeMatch({ humans: 1, bots: 5, fake: true });
  // An unscheduled round uses the supply fallback, exercising the actual match wiring.
  h.m.round = 2;
  h.m.enterSpDraft();
  const sp = h.m.publicView().sp;
  assert.equal(sp.family, 'supply');
  assert.equal(sp.cards.length, 8);
  assert.equal(normalizeSp(sp).cards.length, 8);
  h.m.dispose();
});

test('protocol accepts the sixth seat and eighth choice and rejects indexes beyond the limits', () => {
  assert.equal(validateC2S({ t: 'room.removeBot', seat: 5 }), null);
  assert.equal(validateC2S({ t: 'g.choice', idx: 7 }), null);
  assert.equal(validateC2S({ t: 'g.choice', idx: 8 }), 'bad field idx');
});
