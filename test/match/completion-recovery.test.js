import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { compactResult, createBattleFromSpec } from '../../server/sim/spec.js';
import { FakeBattle } from './fakeBattle.js';

for (const [mode, humans] of [['coop', 6], ['coop10', 10]]) {
  test(`${mode}: 联防 with a missing host result still reaches settlement early`, () => {
    const h = makeMatch({ mode, humans, clientCombat: true, fake: true, instant: false,
      script: () => ({ duration: 1 }), perPlayer: { p_0: { stall: true } } }).start();
    const m = h.m;
    try {
      h.toPrep(1);
      m._startUniteClient({ helpers: [h.ps('p_0')], leakers: [h.ps('p_1')], leaked: [], notReentered: new Map() });
      const f = m.fields[0];
      const start = h.sched.now();
      h.run(() => m.phase === PHASE.SETTLE, { maxTime: 6000 });
      assert.ok(h.sched.now() - start < 6000);
      assert.equal(f.resultSource, 'server');
      assert.equal(f.done, true);
      assert.ok(m.uniteResultView);
      assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
    } finally { m.dispose(); }
  });

  test(`${mode}: other players receive host completion and the round settles without the full timeout`, () => {
    const h = makeMatch({ mode, humans, clientCombat: true, fake: true, instant: false,
      script: () => ({ duration: 1 }), perPlayer: { p_0: { stall: true } } }).start();
    const m = h.m;
    try {
      h.toPrep(1);
      for (const p of m.order) m.handle(p.playerId, { t: 'g.ready', ready: true });
      h.run(() => m.phase === PHASE.COMBAT);
      const f = m.fields.find(f => f.authority === 'p_0');
      const start = h.sched.now();
      h.run(() => m.phase === PHASE.SETTLE, { maxTime: 6000 });
      assert.ok(h.sched.now() - start < 6000);
      assert.equal(f.resultSource, 'server');
      assert.equal(m.publicView().players.find(p => p.playerId === 'p_0').status, 'done');
      assert.ok(h.bc.some(msg => msg.t === 'm.public' && msg.players.find(p => p.playerId === 'p_0')?.status === 'done'));
      assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
    } finally { m.dispose(); }
  });
}

for (const [mode, humans] of [['coop', 6], ['coop10', 10]]) {
  for (const kind of ['normal', 'unite']) {
    test(`${mode} ${kind}: a finished host with a missing result recovers before the combat deadline`, () => {
      const h = makeMatch({ mode, humans, clients: false, clientCombat: true, fake: true,
        instant: false, script: () => ({ duration: 1 }) });
      const m = h.m;
      try {
        m.phase = kind === 'normal' ? PHASE.COMBAT : PHASE.UNITE;
        const f = m._ccField({ fieldId: 'recovery', kind, players: ['p_0'], opts: {
          seed: 1, stageId: m.stageId, players: [{ playerId: 'p_0', units: [] }], spawns: [], timeLimit: 120,
        } });
        m._launch([f]);
        m._maybeFieldsDone = () => {}; // Keep the field visible to assert its public completion state.
        const report = pid => m.handle(pid, { t: 'b.progress', battleId: f.battleId,
          gt: 1, killed: 0, total: 0, done: true });
        report('p_1');
        assert.equal(f.resultWaitTimer, null, 'a teammate cannot end the host field');
        report('p_0');
        const timer = f.resultWaitTimer;
        h.sched.advance(1000);
        report('p_0');
        assert.equal(f.resultWaitTimer, timer, 'repeated progress cannot extend the wait');
        assert.equal(f.done, false, 'done alone is not a trusted result');
        h.sched.advance(2100);
        assert.equal(f.resultSource, 'server');
        assert.equal(f.done, true);
        assert.equal(f.live, false);
        assert.equal(m.publicView().fields[0].progress.done, true);
        assert.equal(f.deadlineTimer, null);
        assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
      } finally { m.dispose(); }
    });
  }
}

test('a valid result cancels recovery and keeps the client result', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, clients: false, clientCombat: true, fake: true,
    instant: false, script: () => ({ duration: 1 }) }).start();
  const m = h.m;
  try {
    h.toPrep(1);
    for (const p of m.order) m.handle(p.playerId, { t: 'g.ready', ready: true });
    h.run(() => m.phase === PHASE.COMBAT);
    const f = m.fields.find(f => f.authority === 'p_0');
    m.handle('p_0', { t: 'b.progress', battleId: f.battleId, gt: 1, killed: 0, total: 0, done: true });
    assert.ok(f.resultWaitTimer);
    const b = createBattleFromSpec(f.spec, m.ds, { BattleClass: FakeBattle });
    while (!b.finished) b.step();
    m.handle('p_0', { t: 'b.result', battleId: f.battleId, result: compactResult(b.result()) });
    assert.equal(f.done, true);
    assert.equal(f.resultWaitTimer, null);
    h.sched.advance(3100);
    assert.equal(f.resultSource, 'client');
  } finally { m.dispose(); }
});
