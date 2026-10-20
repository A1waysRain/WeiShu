import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { startColdWind } from '../../server/sim/content/devices.js';
import { enemyStealthed, canTargetEnemy } from '../../server/sim/targeting.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { flagsOf } from '../../server/sim/snapshot.js';
import { UF } from '../../shared/constants.js';

function setup() {
  const h = makeBattle({
    content: 'none', autoFinish: false, timeLimit: 60,
    defs: {
      chess: { guard_a: chessRec({ id: 'guard_a', skill: null, stats: { atk: 0, maxHp: 1e8, blockCnt: 3 } }) },
      enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e8, atk: 0, speed: 0 }) },
    },
    units: [{ chessId: 'guard_a', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 8] }],
  });
  h.step();
  const e = h.enemies()[0];
  h.b.applyStatus(e, 'stealth', { duration: 50 });
  return { h, e, u: h.unit('guard_a') };
}

test('6 谢拉格 wind cannot apply cold or freeze to an unrevealed stealth enemy', () => {
  const { h, e } = setup();
  startColdWind(h.b, { interval: 1, duration: 8 });
  h.run(2.1);
  assert.ok(enemyStealthed(e));
  assert.ok(!e.s.flags.cold && !e.s.flags.freeze);
  h.b.applyStatus(e, 'reveal', { duration: 8 });
  h.run(1);
  assert.ok(e.s.flags.cold && !e.s.flags.freeze, 'revealed enemies can receive cold');
  h.run(1);
  assert.ok(e.s.flags.freeze, 'revealed enemies can be frozen by the next gust');
  checkInvariants(h.b);
});

for (const key of ['enemy_1019_jshoot', 'enemy_1023_jmage', 'enemy_1299_ymkilr', 'enemy_1283_sgkill']) {
  test(`real 6 谢拉格 + ${key}: stealth blocks cold; blocked enemy stays visible and blocked when frozen`, () => {
    const raw = getDefaultSource().raw.enemies[key];
    const h = makeBattle({
      autoFinish: false, timeLimit: 80,
      defs: {
        chess: { guard_a: chessRec({ id: 'guard_a', bonds: ['kjeragShip'], skill: null, stats: { atk: 0, maxHp: 1e8, blockCnt: 3 } }) },
        enemies: { [key]: { ...raw, stats: { ...raw.stats, maxHp: 1e8, atk: 0, moveSpeed: 0 } } },
      },
      bonds: { kjeragShip: { count: 6, active: true, tier: 2, layers: 100 } },
      units: [{ chessId: 'guard_a', row: 10, col: 4 }],
      enemies: [{ key, pos: [10, 8] }],
    });
    h.step();
    const e = h.enemies()[0], u = h.unit('guard_a');
    assert.ok(enemyStealthed(e), 'real enemy has innate stealth');
    h.run(25.1);
    assert.ok(!e.s.flags.cold, 'first real bond gust does not find a stealth enemy');
    e.x = u.x + 0.3; e.y = u.y;
    assert.ok(h.b._checkBlock(e));
    h.b.applyStatus(e, 'cold', { duration: 40 });
    h.run(25);
    assert.ok(e.s.flags.freeze, 'next real gust freezes the blocked enemy');
    for (let i = 0; i < 80; i++) {
      h.step();
      assert.equal(e.blockedBy, u);
      assert.ok(u.blocking.includes(e));
      const flags = flagsOf(e);
      assert.ok(flags & UF.BLOCKED);
      assert.ok(flags & UF.FROZEN);
      assert.equal(flags & UF.STEALTH, 0, 'client snapshot must not mark a blocked frozen enemy as stealth');
    }
    checkInvariants(h.b);
  });
}

for (const mode of ['direct freeze', 'cold wind']) test(`${mode}: a blocked stealth enemy stays blocked through freeze and thaw`, () => {
  const { h, e, u } = setup();
  e.x = u.x + 0.3; e.y = u.y;
  assert.ok(h.b._checkBlock(e));
  assert.equal(e.blockedBy, u);
  assert.equal(enemyStealthed(e), false);
  if (mode === 'cold wind') {
    const wind = startColdWind(h.b, { interval: 1, duration: 8 });
    h.run(2.1);
    wind.cancel();
  } else h.b.applyStatus(e, 'freeze', { duration: 8 });
  assert.ok(e.s.flags.freeze);
  const pos = [e.x, e.y];
  for (let i = 0; i < 100; i++) {
    h.step();
    assert.equal(e.blockedBy, u);
    assert.ok(u.blocking.includes(e));
    assert.equal(enemyStealthed(e), false);
    assert.ok(canTargetEnemy(u, e, u.profile));
    assert.deepEqual([e.x, e.y], pos);
  }
  h.run(9);
  assert.ok(!e.s.flags.freeze);
  assert.equal(e.blockedBy, u);
  assert.equal(enemyStealthed(e), false);
  checkInvariants(h.b);
});
