// Owner rule: 野鬃 S2 pushes along the attack direction (from the operator to the attacked target),
// regardless of deployment facing. Side/rear/near targets use the same medium force/weight calculation.
// Explicit skill attacks isolate push direction from skill activation and normal target acquisition.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, flatStage } from '../helpers/battleHarness.js';
import { getDefaultSource, hasGeneratedData } from '../../server/sim/simdata.js';
import { PUSH_TILES } from '../../server/sim/constants.js';
import { rotateOffset, toLocal } from '../../server/sim/dir.js';
import { Battle } from '../../server/sim/Battle.js';
import { getData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { setupMatchWaves, buildNormalWave } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';

const REAL = { skip: !hasGeneratedData() };
const approx = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`);
const WILDMN = 'chess_char_1_19_a';
const foe = (key, o = {}) => enemyRec({ key, hp: 1e8, speed: 0, atk: 0, ...o });
const FULL = PUSH_TILES[0]; // 中力 (1) vs weight 1 = 受力等级 0

// her tile per facing on the flat stage: room ahead for a full push and behind for a short one
const HOME = { RIGHT: [10, 4], LEFT: [10, 7], UP: [10, 5], DOWN: [11, 5] };

/**
 * 野鬃 (S2 ready) facing `dir`, one static weight-1 enemy at `off` = [dRow, dCol] from her centre in her facing-RIGHT
 * frame. Returns the enemy's displacement by her first skill hit in that frame: { fwd, side, len }.
 */
function wildmnHit(dir, off, { side = 'L', kind = 'normal', mass = 1 } = {}) {
  const [hr, hc] = HOME[dir];
  // the mirrored right half of a boss field: board (r, c) → field (r − 7, 20 − c), RIGHT ↔ LEFT
  const fr = kind === 'boss' ? hr - 7 : hr, fc = side === 'R' ? 20 - hc : hc;
  const fieldDir = side === 'R' ? { RIGHT: 'LEFT', LEFT: 'RIGHT', UP: 'UP', DOWN: 'DOWN' }[dir] : dir;
  const [ar, ac] = rotateOffset(off[0], off[1], fieldDir);
  let before = null, moved = null;
  const h = makeBattle({
    kind, timeLimit: 30, autoFinish: false, hooks: [],
    stage: flatStage({ rows: Object.fromEntries(Array.from({ length: 19 }, (_, r) => [r, 'r'.repeat(21)])) }),
    rect: { r0: 0, r1: 18, c0: 0, c1: 20 },
    defs: { enemies: { enemy_t: foe('enemy_t', { mass }) } },
    players: [{ playerId: 'p1', seat: 0, side, colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId: WILDMN, row: hr, col: hc, dir, carryState: { sp: 1e3 } }], bonds: {}, playerEffects: [] }],
    setup(b) {
      b.on('beforeAttack', (c) => { if (c.attacker.defId === WILDMN && c.isSkill && c.targets[0]) before = [c.targets[0].y, c.targets[0].x]; }, { priority: -2000 });
      b.on('attack', (c) => { if (c.attacker.defId === WILDMN && c.isSkill && before && !moved) moved = [c.targets[0].y - before[0], c.targets[0].x - before[1]]; }, { priority: -2000 });
    },
  });
  const u = h.unit(WILDMN);
  assert.equal(u.dir, fieldDir, 'field direction');
  h.step();
  const target = h.spawn('enemy_t', { pos: [fr + ar, fc + ac] });
  assert.ok(u.skill.active || u.skill.activate('test', { free: true }), 'S2 on independently of target range');
  assert.ok(h.b.forceAttack(u, [target]), 'an explicit S2 attack exercises its hit effect');
  assert.ok(h.runUntil(() => moved != null, 6), `${side} ${dir} ${off}: a skill hit`);
  const [lf, ll] = toLocal(moved[0], moved[1], fieldDir); // [left (+row in the RIGHT frame), forward]
  return { fwd: ll, side: lf, len: Math.hypot(lf, ll) };
}

test('D2 野鬃 S2: straight-ahead targets move the full medium-force distance in every facing', REAL, () => {
  const ds = getDefaultSource();
  assert.match(ds.rawChess(WILDMN).skill.desc, /往攻击方向/, 'data: the attack-direction wording');
  assert.equal(ds.rawChess(WILDMN).skill.bb['attack@force'], 1, 'data: 中等力度 = 1');
  for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
    const m = wildmnHit(dir, [0, 0.7]);
    approx(m.fwd, FULL, 1e-6, `${dir}: forward`);
    approx(m.side, 0, 1e-9, `${dir}: no sideways`);
  }
});

test('D2 野鬃 S2: target direction does not change medium-force distances for weights 0 through 4', REAL, () => {
  for (const mass of [0, 1, 2, 3, 4]) {
    const m = wildmnHit('RIGHT', [0.3, 0.6], { mass });
    approx(m.len, PUSH_TILES[1 - mass] ?? 0, 1e-6, `weight ${mass}: force minus weight`);
  }
});

test('D2 野鬃 S2: diagonal attacks push toward the attacked target, not deployment facing', REAL, () => {
  for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
    for (const lat of [0.3, -0.3]) {
      const m = wildmnHit(dir, [lat, 0.6]); // 26.6° off, inside her block radius and her range (tile ahead)
      approx(m.fwd, FULL * 0.6 / Math.hypot(lat, 0.6), 1e-6, `${dir} ${lat}: toward the target`);
      approx(m.side, FULL * lat / Math.hypot(lat, 0.6), 1e-6, `${dir} ${lat}: diagonal`);
    }
  }
});

test('D2 野鬃 S2: rear, side and near targets are pushed away at full medium force', REAL, () => {
  for (const dir of ['RIGHT', 'UP', 'LEFT', 'DOWN']) {
    // Targets behind her are pushed backwards relative to deployment facing, away from her centre.
    const back = wildmnHit(dir, [0, -0.45]);
    approx(back.len, FULL, 1e-6, `${dir} behind: full distance`);
    assert.ok(back.fwd < 0 && Math.abs(back.side) < 1e-9, `${dir} behind: radial (away from her)`);
    // Side and nearby targets retain full medium force too.
    const beside = wildmnHit(dir, [0.6, 0.3]);
    approx(beside.len, FULL, 1e-6, `${dir} beside: full distance`);
    approx(beside.side / beside.len, 0.6 / Math.hypot(0.6, 0.3), 1e-6, `${dir} beside: radial`);
    const near = wildmnHit(dir, [0.1, 0.1]);
    approx(near.len, FULL, 1e-6, `${dir} near: full distance`);
    approx(near.side, near.fwd, 1e-6, `${dir} near: radial`);
  }
});

test('D2 野鬃 S2 on the mirrored right half of the Final Assault field: the same pushes in its own direction', REAL, () => {
  for (const dir of ['RIGHT', 'LEFT']) {
    const ahead = wildmnHit(dir, [0, 0.7], { side: 'R', kind: 'boss' });
    approx(ahead.fwd, FULL, 1e-6, `R ${dir}: forward`);
    approx(ahead.side, 0, 1e-9, `R ${dir}: no sideways`);
    const diag = wildmnHit(dir, [0.3, 0.6], { side: 'R', kind: 'boss' });
    approx(diag.fwd, FULL * 0.6 / Math.hypot(0.3, 0.6), 1e-6, `R ${dir} diagonal: toward the target`);
    approx(diag.side, FULL * 0.3 / Math.hypot(0.3, 0.6), 1e-6, `R ${dir} diagonal: sideways`);
    const back = wildmnHit(dir, [0, -0.45], { side: 'R', kind: 'boss' });
    approx(back.len, FULL, 1e-6, `R ${dir} behind: full distance`);
    assert.ok(back.fwd < 0, `R ${dir} behind: away from her`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The real product path: the act2 m01 lane, the match's own R5 wave (server/match/waves.js), 野鬃 on the melee tiles
// next to the lower lane's last bend. Enemies walk through her tile while she holds one; when a push frees her block
// she grabs the one behind her centre — and threw it towards the objective.

function realRun(chessId, r, c, dir, round = 5) {
  const quiet = { warn() {}, error() {}, info() {}, debug() {} };
  const data = getData({ log: quiet });
  const modeId = 'mode_multi_normal';
  const gd = new GameData(data, modeId);
  const setup = setupMatchWaves(gd, createRng(11 + round));
  const w = buildNormalWave(gd, createRng(11 + round + round), setup.factions, round);
  const b = new Battle({
    seed: 7 + r * 31 + c, kind: 'normal', modeId, round, stageId: 'act2autochess_m01', timeLimit: w.timeLimit || 60,
    routes: w.routes, spawns: w.spawns, enemyOverrides: w.overrides ?? {}, fieldId: 'n:P1', logger: quiet,
    players: [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, units: [{ uid: 1, kind: 'chess', chessId, row: r, col: c, dir }] }],
    flags: { layerGainsEnabled: true, dpInit: 10, dpPerSec: 1, dpMax: 99 },
  });
  const u = b.allyUnits.find((x) => x.defId === chessId);
  const pushes = [];
  const orig = b.push.bind(b);
  b.push = (e, force, o = {}) => {
    if (o.from !== u) return orig(e, force, o);
    const x0 = e.x, y0 = e.y, vx = x0 - u.x, vy = y0 - u.y;
    const behind = vx * u.fwd[1] + vy * u.fwd[0] < 0;
    const distance = b.pushDistance(e, force);
    const moved = orig(e, force, o);
    if (moved > 1e-6) pushes.push({ dx: e.x - x0, dy: e.y - y0, moved, behind, vx, vy, distance, massLevel: e.s.massLevel });
    return moved;
  };
  for (let n = 0; !b.finished && n < 30 * 120; n++) b.step();
  return { u, pushes };
}

test('D2 real battle: normal and elite 野鬃 push each attacked target away, including rear targets', REAL, () => {
  let behind = 0, total = 0;
  for (const [r, c] of [[9, 3], [9, 4], [9, 5]]) {
    for (const chessId of ['chess_char_1_19_a', 'chess_char_1_19_b']) {
      const { u, pushes } = realRun(chessId, r, c, 'RIGHT');
      for (const p of pushes) {
        total++;
        if (p.behind) behind++;
        const d = Math.hypot(p.vx, p.vy);
        if (d > 1e-6) {
          assert.ok(p.dx * p.vx + p.dy * p.vy > 0, 'push points away from the operator');
          approx(p.dx * p.vy - p.dy * p.vx, 0, 1e-6, 'push follows the attack direction');
        }
        assert.ok(p.moved <= p.distance + 1e-6, 'medium force still obeys enemy weight and terrain');
      }
    }
  }
  assert.ok(total > 50, `pushes ${total}`);
  assert.ok(behind > 0, 'the hand-over case happens (an enemy grabbed behind her centre)');
});

// ---------------------------------------------------------------------------------------------------------------------
// 琳琅诗怀雅 S3 千金一掷 — PRTS 备注 "金币弹道…推开效果为径向推动": the coin push is radial from her centre.

function swireCoin(off, dir = 'RIGHT') {
  const id = 'chess_char_3_04_a';
  const [hr, hc] = [10, 5];
  const [ar, ac] = rotateOffset(off[0], off[1], dir);
  const h = makeBattle({
    timeLimit: 30, autoFinish: false, hooks: [],
    defs: { enemies: { enemy_t: foe('enemy_t', { mass: 1 }) } },
    units: [{ chessId: id, row: hr, col: hc, dir, skillIndex: 2 }],
    enemies: [{ key: 'enemy_t', pos: [hr + ar, hc + ac] }],
  });
  const u = h.unit(id);
  assert.equal(u.skill.id, 'skchr_swire2_3');
  h.step();
  const e = h.enemies()[0];
  assert.ok(u.skill.active || u.skill.activate('test', { free: true }), 'S3 on');
  u.mem.coins = 1;
  const y0 = e.y, x0 = e.x;
  u.skill.end('manual');
  const [ls, lf] = toLocal(e.y - y0, e.x - x0, dir);
  return { fwd: lf, side: ls, len: Math.hypot(ls, lf) };
}

test('D2 audit: 琳琅诗怀雅 S3 coins push radially from her centre at full force (PRTS 备注 "推开效果为径向推动")', REAL, () => {
  const ds = getDefaultSource();
  const s3 = ds.rawChess('chess_char_3_04_a').skills.find((s) => s.skillId === 'skchr_swire2_3');
  assert.equal(s3.bb.force, 0, 'data: 小力 (normal)');
  const full = PUSH_TILES[-1]; // 小力 (0) vs weight 1
  for (const dir of ['RIGHT', 'UP']) {
    // 20.6° off her direction: radial, so partly sideways (the remake pushed it straight along her facing)
    const a = swireCoin([0.3, 0.8], dir);
    approx(a.len, full, 1e-6, `${dir} cone: full distance`);
    approx(a.side / a.len, 0.3 / Math.hypot(0.3, 0.8), 1e-6, `${dir} cone: radial`);
    // 66° off: radial at full force (the remake turned it into a −2 push: nothing at all)
    const b = swireCoin([0.45, 0.2], dir);
    approx(b.len, full, 1e-6, `${dir} beside: full distance`);
    approx(b.side / b.len, 0.45 / Math.hypot(0.45, 0.2), 1e-6, `${dir} beside: radial`);
  }
});
