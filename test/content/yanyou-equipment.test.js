import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { spawnYanyou } from '../../server/sim/content/tokens.js';

for (const kind of ['normal', 'unite', 'boss']) for (const grade of ['a', 'b']) {
  for (const bond of ['yanShip', 'preciShip', 'maniShip']) for (const sameOwner of [true, false]) {
    test(`${kind}, ${grade}, ${bond}, ${sameOwner ? 'own' : 'partner'}: 炎佑 equipment scope`, () => {
      const pid = sameOwner ? 'p1' : 'p2';
      const h = makeBattle({
        kind, autoFinish: false, captureNoisy: true,
        defs: {
          chess: { carrier_a: chessRec({ id: 'carrier_a', bonds: [bond], skill: null,
            rangeGrid: [[0, 0]], stats: { maxHp: 10000 } }) },
          enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e8, atk: 0, speed: 0 }) },
        },
        players: ['p1', 'p2'].map((playerId, i) => ({
          playerId, seat: i, side: i ? 'R' : 'L', colOffset: 0,
          // Even active 调和 enjoying 炎 bonuses is not an actual 炎 member for collection.
          bonds: { yanShip: { count: 6, active: true, tier: 2, layers: 0 }, maniShip: { count: 1, active: true, tier: 1, layers: 0 } },
          units: playerId === pid ? [{ uid: 1, chessId: 'carrier_a', row: 10, col: 4,
            items: [`chess_item_1_05_e_${grade}`, `chess_item_3_08_e_${grade}`] }] : [],
        })),
      });
      h.step();
      const [y] = spawnYanyou(h.b, 'p1', { atk: 400, hp: 5000 });
      const e = h.spawn('enemy_dummy', { pos: [10, 16] });
      const expected = sameOwner && bond === 'yanShip';
      h.b.dealDamage(y, e, { amount: 1, type: 'true', canDodge: false });
      assert.equal(!!e.s.flags.silence, expected, 'only own actual 炎 carrier grants silence');
      const hp = y.hp;
      const carrier = h.unit('carrier_a');
      const carrierHp = carrier.hp;
      h.run(1.02);
      assert.equal(hp - y.hp, expected ? 60 : 0, 'only own actual 炎 carrier grants solvent drain');
      assert.equal(carrierHp - carrier.hp, 60, 'the carrier itself still takes solvent damage for any bond/owner');
      checkInvariants(h.b);
    });
  }
}
