import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { spawnYanyou } from '../../server/sim/content/tokens.js';

const ds = getDefaultSource();
const sources = [
  { name: '拉普兰德', id: 'chess_char_2_16' },
  { name: '荒芜拉普兰德头狼第二阶段', id: 'chess_char_6_18' },
  { name: '波登可孢子扩散', id: 'chess_char_1_13', ready: true },
  { name: '缄默德克萨斯细雨无声', id: 'chess_char_4_16', skillIndex: 0 },
  { name: '奥术法阵', id: 'chess_char_1_01', item: 'chess_item_3_08_e' },
];

for (const source of sources) for (const grade of ['a', 'b']) {
  for (const key of ['enemy_1267_nhpbr', 'enemy_1267_nhpbr_2']) {
    test(`${source.name} (${grade}) silences ${key} and prevents death pollution`, () => {
      const chessId = `${source.id}_${grade}`;
      const original = ds.raw.enemies[key];
      const h = makeBattle({
        autoFinish: false, timeLimit: 120,
        defs: { enemies: { [key]: { ...original, stats: { ...original.stats, maxHp: 1e8, atk: 0, moveSpeed: 0 } } } },
        units: [{ chessId, row: 10, col: 4,
          ...(source.item ? { items: [`${source.item}_${grade}`] } : {}),
          ...(source.skillIndex != null ? { skillIndex: source.skillIndex } : {}),
          ...(source.ready ? { carryState: { sp: 100 } } : {}),
        }],
        enemies: [{ key, pos: [10, 5] }],
      });
      h.step();
      const e = h.enemies()[0];
      const u = h.unit(chessId);
      assert.ok(h.runUntil(() => e.s.flags.silence, 65), 'real source applies silence');
      assert.ok(h.hooksOf('statusApplied').some(c => c.target === e && c.source === u && c.status === 'silence'));
      h.b.kill(e, u);
      h.run(3);
      assert.equal(h.eventsOf('fx').filter(f => f[1] === 'zone' && f[4]?.kind === 'pollution').length, 0);
    });
  }
}

for (const grade of ['a', 'b']) for (const key of ['enemy_1267_nhpbr', 'enemy_1267_nhpbr_2']) {
  test(`奥术法阵 (${grade}) also grants 炎佑 silence against ${key}`, () => {
    const h = makeBattle({ autoFinish: false, timeLimit: 30,
      units: [{ chessId: 'chess_char_1_03_a', row: 10, col: 4, items: [`chess_item_3_08_e_${grade}`] }],
      enemies: [{ key, pos: [10, 5], mods: { speedMul: 0 } }],
    });
    h.step();
    const e = h.enemies()[0];
    const [y] = spawnYanyou(h.b, 'p1', { atk: 400, hp: 5000 });
    h.b.dealDamage(y, e, { amount: 1, type: 'true', canDodge: false });
    assert.ok(e.s.flags.silence);
    assert.ok(h.hooksOf('statusApplied').some(c => c.target === e && c.source === y && c.status === 'silence'));
    h.b.kill(e, y);
    h.run(3);
    assert.equal(h.eventsOf('fx').filter(f => f[1] === 'zone' && f[4]?.kind === 'pollution').length, 0);
  });
}
