import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { SharedPool } from '../../server/match/pool.js';
import { generateDraft } from '../../server/match/choices.js';
import { createRng } from '../../server/sim/rng.js';
import { compactResult } from '../../server/sim/spec.js';
import { Room } from '../../server/lobby.js';
import { roomCapacity, PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { normalizeSp } from '../../public/js/ui/gameLogic.js';

test('room modes have separate capacities, with the existing coop mode remaining six seats', () => {
  for (const [mode, count] of [['solo', 1], ['coop', 6], ['coop10', 10]]) {
    assert.equal(roomCapacity(mode), count);
    assert.equal(new Room('ABCD', mode, 'HARD', 0).seats.length, count);
    assert.equal(validateC2S({ t: 'room.create', mode, difficulty: 'HARD' }), null);
  }
});

test('ten-player pool and boss HP scale by 2.5 without changing six-player scaling', () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  for (const count of [6, 10]) {
    const pool = new SharedPool(gd, { playerCount: count });
    for (const [id, entry] of pool.entries) assert.equal(entry.cap, Math.ceil(gd.poolCopies(id) * count / 4));
    assert.equal(gd.bossPoolShare(count), gd.bossPoolShare(4) * count / 4);
  }
});

test('ten-player drafts provide twelve cards at every scheduled stage, including distinct bounties', () => {
  for (const difficulty of ['funny', 'normal', 'hard', 'abyss']) {
    const gd = new GameData(DATA, `mode_multi_${difficulty}`);
    for (const round of [2, 3, 6, 9, 11]) {
      for (let seed = 1; seed <= 40; seed++) {
        const draft = generateDraft(gd, createRng(seed), round, { playerCount: 10 });
        assert.equal(draft.cards.length, 12, `${difficulty} R${round} seed ${seed} ${draft.family}`);
        assert.equal(normalizeSp(draft).cards.length, 12);
        if (draft.family === 'bounty') assert.equal(new Set(draft.cards.map(c => c.id)).size, 12);
      }
    }
  }
});

test('all ten players can pick, including the twelfth card, and coop10 identity survives match construction', () => {
  const h = makeMatch({ mode: 'coop10', humans: 10, difficulty: 'HARD', fake: true });
  try {
    assert.equal(h.m.mode, 'coop10');
    h.m.round = 3;
    h.m.enterSpDraft();
    assert.equal(h.m.sp.cards.length, 12);
    for (const idx of [11, 0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      assert.deepEqual(h.m.pickCard(h.m.players.get(h.m.spTurn()), idx), { ok: true });
    }
    h.sched.advance(1);
    assert.equal(h.m.phase, PHASE.PREP);
  } finally { h.m.dispose(); }
});

test('ten-player result transport retains the tenth player and rejects out-of-range input', () => {
  const perPlayer = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`p_${i}`, { total: i + 1, killed: 1, leaked: [] }]));
  const result = compactResult({ perPlayer });
  assert.deepEqual(Object.keys(result.perPlayer), Object.keys(perPlayer));
  assert.equal(result.perPlayer.p_9.total, 10);
  assert.equal(validateC2S({ t: 'room.removeBot', seat: 9 }), null);
  assert.equal(validateC2S({ t: 'room.removeBot', seat: 10 }), 'bad field seat');
  assert.equal(validateC2S({ t: 'room.kick', seat: 9, playerId: 'p_9' }), null);
  assert.equal(validateC2S({ t: 'g.choice', idx: 11 }), null);
  assert.equal(validateC2S({ t: 'g.choice', idx: 12 }), 'bad field idx');
});

test('ten players reach a common final assault with five fields, shared boss HP and merged team LP', () => {
  const h = makeMatch({ mode: 'coop10', humans: 10, difficulty: 'FUNNY', fake: true,
    script: b => b.kind === 'boss' ? { bossDps: 1e9 } : {} }).start();
  try {
    h.toPrep(14);
    const lp = [...h.m.players.values()].reduce((sum, p) => sum + p.lp, 0);
    assert.ok(h.drive(() => h.m.phase === PHASE.FINAL_ASSAULT));
    assert.equal(h.m.teamLp, lp);
    assert.equal(h.m.fields.length, 5);
    assert.equal(new Set(h.m.fields.flatMap(f => f.players)).size, 10);
    const pool = h.m.fields[0].battle.sharedBoss;
    assert.ok(h.m.fields.every(f => f.battle.sharedBoss === pool));
    h.drive(() => !!h.ended);
    assert.ok(h.ended);
  } finally { h.m.dispose(); }
});

test('ten-player client combat assigns five authorities and accepts damage from the final pair', () => {
  const h = makeMatch({ mode: 'coop10', humans: 10, difficulty: 'FUNNY', fake: true,
    clientCombat: true, instant: false,
    script: b => b.kind === 'boss' ? { bossDps: 20000 } : { duration: 2 } }).start();
  try {
    assert.ok(h.drive(() => h.m.phase === PHASE.FINAL_ASSAULT));
    const fields = h.m.fields;
    assert.equal(fields.length, 5);
    assert.deepEqual(fields.map(f => f.authority), ['p_0', 'p_2', 'p_4', 'p_6', 'p_8']);
    const max = h.m.bossPool.maxHp;
    h.sched.advance(3000);
    assert.ok(fields.every(f => f.bossAcked > 0));
    assert.ok(Math.abs(max - h.m.bossPool.hp - fields.reduce((sum, f) => sum + f.bossAcked, 0)) < 1e-6);
    const starts = h.sent.filter(([, msg]) => msg.t === 'b.start' && msg.kind === 'boss');
    assert.equal(new Set(starts.map(([pid]) => pid)).size, 10);
  } finally { h.m.dispose(); }
});

test('ten-player unite includes leaks from the tenth player and retains the existing helper limit', () => {
  const h = makeMatch({ mode: 'coop10', humans: 10, fake: true,
    script: b => b.kind === 'normal' ? { leaks: { p_9: 3 } } : {} }).start();
  try {
    assert.ok(h.drive(() => h.m.phase === PHASE.UNITE));
    assert.deepEqual(h.m.unitePlan.leakers.map(p => p.playerId), ['p_9']);
    assert.equal(h.m.unitePlan.helpers.length, h.m.gd.unite.maxHelpers);
    assert.equal(h.m.unitePlan.leaked.length, 3);
    for (let i = 0; i < 10; i++) {
      assert.equal(h.lastTo(`p_${i}`, 'm.field').fieldId, 'u');
    }
  } finally { h.m.dispose(); }
});
