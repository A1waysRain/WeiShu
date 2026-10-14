import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const source = getDefaultSource();
const skills = [
  ['引星棘刺 S1', 'chess_char_5_15_a', 'skchr_thorn2_1'],
  ['引星棘刺 S2', 'chess_char_5_15_a', 'skchr_thorn2_2'],
  ['锡人 S2', 'chess_char_2_19_a', 'skchr_tinman_2'],
  ['铃兰 S3', 'chess_char_5_10_a', 'skchr_lisa_3'],
  ['安洁莉娜天赋', 'chess_char_5_20_a', null],
  ['调香师天赋', 'chess_char_2_14_a', null],
  ['浊心斯卡蒂 S2', 'chess_char_6_04_a', 'skchr_skadi2_2'],
  ['瑕光 S2', 'chess_char_3_12_a', 'skchr_blemsh_2'],
];

for (const [name, baseId, skillId] of skills) {
  for (const golden of [false, true]) {
    test(`${name} ${golden ? 'elite' : 'normal'}: HP recovery reaches unhealable operators and real summons`, () => {
      const id = golden ? baseId.replace(/_a$/, '_b') : baseId;
      const raw = source.rawChess(id);
      const selected = skillId ? raw.skills.find(s => s.skillId === skillId) : null;
      assert.ok(!skillId || selected, `${id} has ${skillId}`);
      const h = makeBattle({
        defs: { chess: { t_ally: chessRec({ id: 't_ally', skill: null, stats: { maxHp: 10000, atk: 0 } }) },
          enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e8, atk: 0, speed: 0 }) } },
        units: [{ chessId: id, row: 10, col: ['chess_char_6_04_a', 'chess_char_3_12_a'].includes(baseId) ? 4 : 3, ...(selected ? { skillIndex: selected.index } : {}) },
          { chessId: 't_ally', row: 11, col: 5 }],
        enemies: [{ key: 'e_dummy', pos: [10, 5] }],
        autoFinish: false, timeLimit: 60, hooks: ['heal'], captureNoisy: true,
      }).step();
      const caster = h.unit(id), ally = h.unit('t_ally');
      const wolf = h.b.spawnToken(caster, 'token_10028_vigil_wolf', 9, 5, { anySource: true });
      const water = h.b.spawnToken(caster, 'token_10030_mlyss_wtrman', 10, 5, { anySource: true });
      assert.ok(wolf && water);
      for (const target of [ally, wolf, water]) {
        target.hp = target.s.maxHp * 0.2;
        h.b.addBuff(target, { key: 'test:noheal', flags: { noHeal: true, healFree: true },
          mods: { healingTakenMul: 0 } });
        assert.equal(h.b.heal(caster, target, 100), 0, 'ordinary healing remains blocked');
      }
      if (selected) {
        caster.skill.gainSp(1000);
        if (skillId === 'skchr_blemsh_2') assert.ok(caster.skill.activate('test', { free: true }));
        assert.ok(h.runUntil(() => caster.skill.activations > 0, 5), 'skill casts');
      } else {
        h.b.addBuff(caster, { key: 'test:silence', flags: { silence: true } });
      }
      const before = new Map([ally, wolf, water].map(t => [t, t.hp]));
      h.run(2);
      for (const target of [ally, wolf, water]) {
        assert.ok(target.hp > before.get(target), `${target.def.id ?? target.def.key}: recovered HP despite noHeal and zero healing multiplier`);
      }
      assert.deepEqual(h.b.errors, []);
      checkInvariants(h.b);
    });
  }
}

test('HP recovery bypasses healing multipliers but never revives an undeployed unit', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_5_20_a', row: 10, col: 3 },
    { chessId: 'chess_char_4_18_a', row: 10, col: 5 }], autoFinish: false }).step();
  const caster = h.unit('chess_char_5_20_a'), mudrock = h.unit('chess_char_4_18_a');
  h.b.addBuff(caster, { key: 'test:healboost', mods: { healingDealtMul: 3 } });
  h.b.addBuff(mudrock, { key: 'test:healreduce', mods: { healingTakenMul: 0.5 } });
  mudrock.hp = mudrock.s.maxHp * 0.5;
  assert.equal(h.b.heal(caster, mudrock, 100), 0, 'real unhealable operator rejects direct healing');
  assert.equal(h.b.heal(caster, mudrock, 100, { regen: true }), 100);
  mudrock.deployed = false;
  assert.equal(h.b.heal(caster, mudrock, 100, { regen: true }), 0);
});

test('bard trait recovers HP for an unhealable ally without enabling ordinary healing', () => {
  const h = makeBattle({ defs: { chess: {
    t_bard: chessRec({ id: 't_bard', profession: 'SUPPORT', subProfessionId: 'bard', skill: null,
      rangeGrid: [[0, 0], [0, 1]], stats: { atk: 1000 } }),
    t_ally: chessRec({ id: 't_ally', skill: null, stats: { maxHp: 10000 } }),
  } }, units: [{ chessId: 't_bard', row: 10, col: 4 }, { chessId: 't_ally', row: 10, col: 5 }],
  content: 'none', autoFinish: false }).step();
  const bard = h.unit('t_bard'), target = h.unit('t_ally');
  h.b.addBuff(target, { key: 'test:noheal', flags: { noHeal: true, healFree: true }, mods: { healingTakenMul: 0 } });
  target.hp = 1000;
  h.run(3.05);
  assert.equal(target.hp, 1300);
  assert.equal(h.b.heal(bard, target, 100), 0);
  checkInvariants(h.b);
});

test('百炼嘉维尔 receives her talent bonus on direct healing, but not on HP recovery', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_5_18_a', row: 10, col: 4 }], autoFinish: false }).step();
  const target = h.unit('chess_char_5_18_a');
  const bb = target.def.raw.talents.find(t => t.index === 1).bb;
  for (const [ratio, bonus] of [[0.3, bb.heal_scale_2], [0.8, bb.heal_scale_1]]) {
    target.hp = target.s.maxHp * ratio;
    assert.equal(h.b.heal(null, target, 100), 100 * bonus);
    assert.equal(h.b.heal(null, target, 100, { regen: true }), 100);
  }
  checkInvariants(h.b);
});

for (const [id, threshold] of [['chess_char_6_03_a', 4], ['chess_char_6_03_b', 2]]) {
  for (const count of [threshold - 1, threshold]) {
    test(`余 ${id}: S3 HP recovery with ${count} deployed operators (threshold ${threshold}); summons do not count`, () => {
      const defs = Object.fromEntries(Array.from({ length: count - 1 }, (_, i) => [`t_${i}`,
        chessRec({ id: `t_${i}`, skill: null, stats: { maxHp: 10000, atk: 0 } })]));
      const positions = [[9, 3], [11, 3], [12, 3]];
      const h = makeBattle({ defs: { chess: defs }, units: [
        { chessId: id, row: 10, col: 3 },
        ...positions.slice(0, count - 1).map(([row, col], i) => ({ chessId: `t_${i}`, row, col })),
      ], autoFinish: false, timeLimit: 60, hooks: ['heal'], captureNoisy: true }).step();
      h.run(1);
      const yu = h.unit(id);
      const wolf = h.b.spawnToken(yu, 'token_10028_vigil_wolf', 10, 5, { anySource: true });
      const water = h.b.spawnToken(yu, 'token_10030_mlyss_wtrman', 11, 5, { anySource: true });
      assert.ok(wolf && water);
      const ops = h.b.allies(yu.ownerId).filter(a => a.kind === 'op');
      assert.equal(ops.length, count, 'all required operators are actually deployed');
      assert.equal(yu.def.talents[1].bb.cnt, threshold);
      h.b.addBuff(yu, { key: 'test:healingboost', mods: { healingDealtMul: 3 } });
      const targets = [...ops, wolf, water];
      for (const a of targets) {
        h.b.addBuff(a, { key: 'test:noheal', flags: { noHeal: true, healFree: true }, mods: { healingTakenMul: 0 } });
        a.hp = a.s.maxHp * 0.3;
      }
      assert.ok(yu.skill.activate('test', { free: true }));
      assert.ok(yu.skill.active);
      h.step(); // Resolve S3's max-HP buff before measuring the talent's recovery.
      const before = new Map(targets.map(a => [a, a.hp]));
      h.run(2.1);
      for (const a of ops) {
        if (count >= threshold) assert.ok(a.hp > before.get(a), 'S3 restores every eligible operator despite noHeal');
        else assert.equal(a.hp, before.get(a), 'below the operator threshold: no HP recovery');
      }
      assert.equal(wolf.hp, before.get(wolf), 'S3 talent recipients are operators, not summons');
      assert.equal(water.hp, before.get(water));
      const pulses = h.hooksOf('heal').filter(c => c.source === yu && c.opts?.regen);
      if (count >= threshold) {
        for (const a of ops) assert.ok(pulses.some(c => c.target === a
          && Math.abs(c.amount - a.s.maxHp * yu.def.talents[1].bb.hp_recovery_per_sec_by_max_hp_ratio) < 1e-6),
        'recovery amount uses target max HP without healing multipliers');
      } else assert.equal(pulses.length, 0);
      assert.deepEqual(h.b.errors, []);
      checkInvariants(h.b);
    });
  }
}
