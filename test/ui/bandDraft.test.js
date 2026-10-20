// Strategy draft 队友已选 (research 09 §5 / §7, DESIGN §14 corrections): a strategy a teammate already picked cannot be
// chosen again — the server refuses it (server/match/match/phases.js pickBand → BAD_TARGET '队友已选'), bots re-draw, and the
// UI marks it (screens/bandDraft.js teammateBands). Automatic assignments (a turn that runs out, a departing seat) give
// the official default 「华法琳」 only while no teammate holds it, else the first free strategy (match/phases.js defaultBand; the
// UI names it: bandDraft.js timeoutBand) — a timed-out turn takes the highlighted band first (g.bandFocus, match/phases.js
// timeoutBand; user playtest #4 item 4: one countdown, BAND_TURN_SECONDS per turn, no separate step cap).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { makeMatch, DATA } from '../match/harness.js';
import { teammateBands, timeoutBand, allowedBands, autoPickBand, draftClock, draftTip, draftSelection } from '../../public/js/screens/bandDraft.js';
import { BAND_TURN_SECONDS } from '../../server/match/Match.js';

const TURN_MS = BAND_TURN_SECONDS * 1000;

function draftOf(o) {
  const h = makeMatch({ mode: 'coop', ...o }).start();
  for (const ps of h.m.players.values()) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.infoReady' });
  h.sched.advance(1);
  assert.equal(h.m.phase, PHASE.BAND_DRAFT);
  return h;
}

describe('server: skip requires a successor and remaining quota', () => {
  for (const humans of [2, 3, 4]) test(`${humans} humans: the final unpicked player cannot pass to a finished player`, () => {
    const h = draftOf({ humans, seed: 5 });
    const m = h.m;
    try {
      const order = m.draft.order.slice();
      for (let i = 0; i < order.length - 1; i++) {
        const pid = order[i];
        assert.equal(m.draftTurn(), pid);
        assert.deepEqual(m.handle(pid, { t: 'g.band', bandId: m.defaultBand(pid) }), { ok: true });
      }
      const last = order.at(-1);
      assert.equal(m.draftTurn(), last);
      assert.equal(m.publicView().draft.order.length, humans, 'the published order retains finished players');
      assert.equal(m.draft.skipsLeft[last], 1);
      assert.deepEqual(m.handle(last, { t: 'g.bandSkip' }), { error: ERR.BAD_TARGET, detail: 'nobody to pass to' });
      assert.equal(m.draftTurn(), last);
      assert.equal(m.draft.skipsLeft[last], 1, 'a refused skip consumes no quota');
      assert.deepEqual(m.handle(last, { t: 'g.band', bandId: m.defaultBand(last) }), { ok: true });
    } finally { m.dispose(); }
  });

  test('passing works before the final position, but a spent quota cannot be used again', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    try {
      const [first, second, third] = m.draft.order;
      assert.deepEqual(m.handle(first, { t: 'g.bandSkip' }), { ok: true });
      assert.equal(m.draftTurn(), second);
      assert.deepEqual(m.handle(second, { t: 'g.bandSkip' }), { ok: true });
      assert.equal(m.draftTurn(), third);
      assert.deepEqual(m.handle(third, { t: 'g.band', bandId: m.defaultBand(third) }), { ok: true });
      assert.equal(m.draftTurn(), first);
      assert.equal(m.draft.order.length - m.draft.idx, 2);
      assert.deepEqual(m.handle(first, { t: 'g.bandSkip' }), { error: ERR.ALREADY, detail: 'no skip left' });
      assert.equal(m.draftTurn(), first);
    } finally { m.dispose(); }
  });
});

describe('server: no duplicate strategies in the co-op draft', () => {
  test('a band picked by a teammate is refused with 队友已选; a free one is accepted', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    const [first, second, third] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_sarkazb' }), { ok: true });
    const dup = m.handle(second, { t: 'g.band', bandId: 'band_sarkazb' });
    assert.deepEqual(dup, { ok: true }, 'duplicate accepted');
    assert.equal(m.draftTurn(), third, 'accepted pick advances the turn');
    assert.equal(m.bandTaken('band_sarkazb', second), true);
    assert.equal(m.bandTaken('band_sarkazb', first), true, 'the second teammate now shares the strategy');
    assert.equal(m.handle(second, { t: 'g.band', bandId: 'band_lisa' }).error, ERR.ALREADY);
    assert.deepEqual(m.handle(third, { t: 'g.band', bandId: 'band_sarkazb' }), { ok: true });
    const picks = Object.values(m.publicView().draft?.picks || m.draft.picks);
    assert.deepEqual(picks, ['band_sarkazb', 'band_sarkazb', 'band_sarkazb'], 'all players share their chosen strategy');
    h.sched.advance(1);
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    m.dispose();
  });

  test('bots pick allowed strategies', () => {
    for (const seed of [1, 2, 3, 4, 6, 9, 11]) {
      const h = draftOf({ humans: 1, bots: 3, seed });
      const m = h.m;
      // the human picks first when it is their turn; bots pick by themselves
      h.run(() => m.phase !== PHASE.BAND_DRAFT || m.draftTurn() === 'p_0', { maxTime: 20000 });
      if (m.phase === PHASE.BAND_DRAFT) assert.deepEqual(m.handle('p_0', { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
      h.run(() => m.phase !== PHASE.BAND_DRAFT, { maxTime: 60000 });
      const ids = [...m.players.values()].map((p) => p.bandId);
      for (const id of ids) assert.ok(DATA.bands[id], id);
      m.dispose();
    }
  });

  test('six players, including five AI, may all choose the same strategy', () => {
    const h = makeMatch({ mode: 'coop', humans: 1, bots: 5, seed: 5 }).start();
    const m = h.m;
    // Force the AI strategy draw to the same legal choice as the human.
    m.gd.bandIds = () => ['band_sarkazb'];
    m.handle('p_0', { t: 'g.infoReady' });
    h.sched.advance(1);
    h.run(() => m.draftTurn() === 'p_0', { maxTime: 20000 });
    assert.deepEqual(m.handle('p_0', { t: 'g.band', bandId: 'band_sarkazb' }), { ok: true });
    h.run(() => m.phase !== PHASE.BAND_DRAFT, { maxTime: 20000 });
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    for (const ps of m.players.values()) {
      assert.equal(ps.bandId, 'band_sarkazb');
      assert.equal(ps.lp, 45);
    }
    h.ps('p_0').lp--;
    for (const ps of m.players.values()) if (ps.playerId !== 'p_0') assert.equal(ps.lp, 45);
    m.dispose();
  });

  test('solo: the rule has nothing to compare against', () => {
    const h = makeMatch({ mode: 'solo', seed: 2 }).start();
    h.m.handle('p_0', { t: 'g.infoReady' });
    h.sched.advance(1);
    assert.equal(h.m.bandTaken('band_orchid', 'p_0'), false);
    assert.deepEqual(h.m.handle('p_0', { t: 'g.band', bandId: 'band_orchid' }), { ok: true });
    h.m.dispose();
  });
});

describe('UI: teammateBands', () => {
  test('maps each band a teammate picked to its pickers; never the viewer', () => {
    const picks = new Map([['a', 'band_x'], ['b', 'band_y'], ['c', 'band_x'], ['me', 'band_z']]);
    const t = teammateBands(picks, 'me');
    assert.deepEqual([...t.keys()].sort(), ['band_x', 'band_y']);
    assert.deepEqual(t.get('band_x'), ['a', 'c']);
    assert.equal(t.has('band_z'), false);
    assert.equal(teammateBands(null, 'me').size, 0);
  });
});

describe('UI: draftSelection (review regression)', () => {
  test('a teammate picking the highlighted strategy does not change my selection', async () => {
    const { draftSelection } = await import('../../public/js/screens/bandDraft.js');
    const bands = [{ bandId: 'a' }, { bandId: 'b' }, { bandId: 'c' }];
    const taken = new Map([['a', ['p1']]]);
    assert.equal(draftSelection(null, { bands, taken, myPick: null, myTurn: false }), 'a', 'default: first allowed');
    assert.equal(draftSelection(null, { bands, taken, myPick: 'c', myTurn: false }), 'c', 'default: my pick');
    assert.equal(draftSelection('a', { bands, taken, myPick: null, myTurn: false }), 'a', 'browsing a taken band is fine while waiting');
    assert.equal(draftSelection('a', { bands, taken, myPick: null, myTurn: true }), 'a', 'my turn: keep the shared strategy');
    assert.equal(draftSelection('c', { bands, taken, myPick: null, myTurn: true }), 'c', 'a free selection is kept');
    assert.equal(draftSelection('a', { bands, taken, myPick: 'c', myTurn: false }), 'a', 'after my pick nothing moves');
    assert.equal(draftSelection('x', { bands: [], taken, myPick: null, myTurn: true }), 'x', 'no bands: unchanged');
  });
});

describe('server: automatic assignments allow repeated strategies', () => {
  const validPicks = (m) => {
    const ids = [...m.players.values()].map((p) => p.bandId);
    for (const id of ids) assert.ok(DATA.bands[id], id);
    return ids;
  };

  test('a turn that runs out without a highlight always assigns 华法琳', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    const [first, second, third] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
    assert.equal(m.defaultBand(second), 'band_bldsk', 'shared default');
    h.sched.advance(TURN_MS - 1);
    assert.equal(m.draft.picks[second], undefined, `the whole ${BAND_TURN_SECONDS} s`);
    h.sched.advance(2);
    assert.equal(m.draft.picks[second], 'band_bldsk', 'timeout can repeat 华法琳');
    assert.equal(h.ps(second).lp, DATA.bands.band_bldsk.totalHp, 'the LP of the assigned strategy');
    assert.equal(m.draftTurn(), third);
    h.sched.advance(TURN_MS + 1);
    assert.equal(m.draft.picks[third], 'band_bldsk');
    validPicks(m);
    m.dispose();
  });

  test('a turn that runs out takes the highlighted strategy even when a teammate picked it', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    const [first, second, third] = m.draft.order;
    // highlights may come before the turn; the last one counts; null clears it
    assert.deepEqual(m.handle(third, { t: 'g.bandFocus', bandId: 'band_lisa' }), { ok: true });
    assert.deepEqual(m.handle(second, { t: 'g.bandFocus', bandId: 'band_amiya' }), { ok: true });
    assert.deepEqual(m.handle(second, { t: 'g.bandFocus', bandId: 'band_sarkazb' }), { ok: true });
    assert.equal(m.handle(second, { t: 'g.bandFocus', bandId: 'band_nope' }).error, ERR.BAD_TARGET);
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_lisa' }), { ok: true });
    assert.equal(m.handle(first, { t: 'g.bandFocus', bandId: 'band_amiya' }).error, ERR.ALREADY, 'nothing to highlight after the pick');
    h.sched.advance(TURN_MS + 1);
    assert.equal(m.draft.picks[second], 'band_sarkazb', 'the highlighted strategy');
    assert.equal(h.ps(second).lp, DATA.bands.band_sarkazb.totalHp);
    // The third player's highlight remains selectable after the first teammate picks it.
    assert.equal(m.timeoutBand(third), 'band_lisa', 'highlight remains usable after a teammate picks it');
    h.sched.advance(TURN_MS + 1);
    assert.equal(m.draft.picks[third], 'band_lisa');
    validPicks(m);
    m.dispose();
    const h2 = draftOf({ humans: 2, seed: 5 });
    const [a] = h2.m.draft.order;
    assert.deepEqual(h2.m.handle(a, { t: 'g.bandFocus', bandId: 'band_amiya' }), { ok: true });
    assert.deepEqual(h2.m.handle(a, { t: 'g.bandFocus' }), { ok: true }, 'cleared');
    h2.sched.advance(TURN_MS + 1);
    assert.equal(h2.m.draft.picks[a], 'band_bldsk', 'no highlight: the default');
    assert.equal(h2.m.handle(a, { t: 'g.bandFocus', bandId: 'band_amiya' }).error, ERR.ALREADY);
    h2.m.dispose();
  });

  test('the default stays 华法琳 while nobody holds it (also for a player whose teammates picked others)', () => {
    const h = draftOf({ humans: 2, seed: 5 });
    const m = h.m;
    const [first, second] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_amiya' }), { ok: true });
    assert.equal(m.defaultBand(second), 'band_bldsk');
    h.sched.advance(TURN_MS + 1);
    assert.equal(m.draft.picks[second], 'band_bldsk');
    m.dispose();
  });

  test('every human idle: all turn timeouts assign 华法琳 (no separate step cap)', () => {
    const h = draftOf({ humans: 4, seed: 9 });
    const m = h.m;
    h.run(() => m.phase !== PHASE.BAND_DRAFT, { maxTime: 4 * TURN_MS + 1 });
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    const ids = validPicks(m);
    assert.deepEqual(ids, Array(4).fill('band_bldsk'));
    for (const ps of m.players.values()) assert.equal(ps.lp, DATA.bands[ps.bandId].totalHp, `${ps.playerId} LP follows its strategy`);
    m.dispose();
  });

  test('finishBandDraft assigns the same default to all remaining seats', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    const [first] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
    m.finishBandDraft(true);
    assert.deepEqual(validPicks(m), Array(3).fill('band_bldsk'));
    assert.equal(m.phase, PHASE.BATTLE_CHECK);
    m.dispose();
  });

  test('a departing seat receives the default even if a teammate picked it; mixed bots remain valid', () => {
    const h = draftOf({ humans: 3, seed: 5 });
    const m = h.m;
    const [first, second] = m.draft.order;
    assert.deepEqual(m.handle(first, { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
    m.onLeave(second);
    assert.equal(m.draft.picks[second], 'band_bldsk', 'the leaver gets the shared default');
    assert.ok(DATA.bands[m.draft.picks[second]]);
    m.dispose();
    for (const seed of [1, 2, 3, 4]) {
      const h2 = draftOf({ humans: 2, bots: 2, seed });
      h2.run(() => h2.m.phase !== PHASE.BAND_DRAFT, { maxTime: 4 * TURN_MS + 1 });
      assert.ok(Object.values(h2.m.draft.picks).every((id) => DATA.bands[id]));
      h2.m.dispose();
    }
  });
});

describe('UI: timeoutBand (the tip names what a timeout gives me)', () => {
  const bands = allowedBands([
    { bandId: 'band_amiya', sortId: 2 }, { bandId: 'band_bldsk', sortId: 1 }, { bandId: 'band_duyaoy', sortId: 3 },
    { bandId: 'band_solo', sortId: 0, modeTypeList: ['SINGLE'] },
  ], 'MULTI');
  test('allowedBands keeps the server order (sortId, then id) and the mode filter', () => {
    assert.deepEqual(bands.map((b) => b.bandId), ['band_bldsk', 'band_amiya', 'band_duyaoy']);
  });
  test('华法琳 remains the default regardless of teammates\' choices', () => {
    assert.equal(timeoutBand(bands, new Map()), 'band_bldsk');
    assert.equal(timeoutBand(bands, new Map([['band_amiya', ['a']]])), 'band_bldsk');
    assert.equal(timeoutBand(bands, new Map([['band_bldsk', ['a']]])), 'band_bldsk');
    assert.equal(timeoutBand(bands, new Map([['band_bldsk', ['a']], ['band_amiya', ['b']]])), 'band_bldsk');
    assert.equal(timeoutBand([], new Map()), 'band_bldsk', 'no data yet: the official default');
    assert.equal(timeoutBand(bands, null), 'band_bldsk');
  });
  test('matches the server for every combination of taken strategies', () => {
    const h = draftOf({ humans: 4, seed: 3 });
    const m = h.m;
    const all = allowedBands(Object.values(DATA.bands), 'MULTI');
    assert.deepEqual(all.map((b) => b.bandId), m.gd.bandIds(), 'same order as gd.bandIds');
    const [a, b, c, d] = m.draft.order;
    for (const picks of [[], ['band_bldsk'], ['band_bldsk', 'band_amiya'], ['band_amiya', 'band_duyaoy'], ['band_bldsk', 'band_amiya', 'band_duyaoy']]) {
      m.draft.picks = Object.fromEntries(picks.map((id, i) => [[a, b, c][i], id]));
      const taken = teammateBands(new Map(Object.entries(m.draft.picks)), d);
      assert.equal(timeoutBand(all, taken), m.defaultBand(d), `picks ${picks}`);
    }
    m.dispose();
  });
});

describe('UI: one countdown and the highlighted band (user playtest #4 item 4)', () => {
  const bands = allowedBands([
    { bandId: 'band_amiya', sortId: 2 }, { bandId: 'band_bldsk', sortId: 1 }, { bandId: 'band_duyaoy', sortId: 3 },
  ], 'MULTI');

  test('draftClock: the step header counts the current turn down (m.public.deadline = draft.turnDeadline); untimed ⇒ none', () => {
    assert.deepEqual(draftClock({ deadline: 5000, draft: { turnDeadline: 5000, turnSeconds: 30 } }), { deadline: 5000, total: 30 });
    assert.deepEqual(draftClock({ deadline: 0, draft: { turnDeadline: 7000, turnSeconds: 30 } }), { deadline: 7000, total: 30 }, 'the turn deadline stands in');
    assert.equal(draftClock({ deadline: 0, draft: { turnDeadline: 0, untimed: true, turnSeconds: 0 } }), null);
    assert.equal(draftClock({ deadline: 9000, draft: { untimed: true } }), null, 'an untimed draft shows no clock');
    assert.equal(draftClock({ deadline: 0, draft: { turnDeadline: 0 } }), null);
    assert.equal(draftClock(null), null);
    assert.deepEqual(draftClock({ deadline: 4000, draft: {} }), { deadline: 4000, total: null });
  });

  test('the server publishes one clock: deadline = turnDeadline, turnSeconds = the turn length; AI seats pick at once', () => {
    const h = draftOf({ humans: 2, bots: 2, seed: 9 });
    const m = h.m;
    h.sched.advance(1);
    const turn = m.draftTurn();
    assert.ok(turn && !turn.startsWith('ai_'), `a human's turn after the AI seats picked at once (${m.draft.order})`);
    const pub = m.publicView();
    assert.equal(pub.deadline, pub.draft.turnDeadline, 'one countdown');
    assert.equal(pub.draft.turnSeconds, BAND_TURN_SECONDS);
    assert.ok(Math.abs(pub.deadline - h.sched.now() - TURN_MS) <= 2, 'a whole turn left');
    assert.deepEqual(draftClock(pub), { deadline: pub.deadline, total: BAND_TURN_SECONDS });
    m.dispose();
  });

  test('autoPickBand: the highlighted allowed band, else timeoutBand; nothing after my pick', () => {
    assert.equal(autoPickBand('band_duyaoy', { bands, taken: new Map() }), 'band_duyaoy');
    assert.equal(autoPickBand('band_duyaoy', { bands, taken: new Map([['band_duyaoy', ['a']]]) }), 'band_duyaoy', '队友已选 still selectable');
    assert.equal(autoPickBand(null, { bands, taken: new Map() }), 'band_bldsk');
    assert.equal(autoPickBand('band_unknown', { bands, taken: new Map() }), 'band_bldsk', 'not a band of the mode');
    assert.equal(autoPickBand('band_amiya', { bands, taken: new Map([['band_bldsk', ['a']], ['band_amiya', ['b']]]) }), 'band_amiya');
    assert.equal(autoPickBand('band_amiya', { bands, taken: new Map(), myPick: 'band_amiya' }), null);
  });

  test('the selection starts on the timeout default 华法琳, so the tip names the highlighted band', () => {
    assert.equal(draftSelection(null, { bands, taken: new Map(), myPick: null, myTurn: false }), 'band_bldsk');
    assert.equal(draftSelection(null, { bands, taken: new Map([['band_bldsk', ['a']]]), myPick: null, myTurn: true }), 'band_bldsk');
    assert.equal(draftSelection('band_bldsk', { bands, taken: new Map([['band_bldsk', ['a']]]), myPick: null, myTurn: true }), 'band_bldsk', 'taken on my turn remains selectable');
    assert.match(draftTip({ timed: true, turnSeconds: 30, autoName: '华法琳' }), /每位博士有 30 秒，超时将自动选择当前选中的「华法琳」/);
    assert.match(draftTip({ timed: true, turnSeconds: 30, autoName: '阿米娅', selected: false }), /超时将自动选择「阿米娅」$/);
    assert.equal(draftTip({ timed: true, turnSeconds: 30, autoName: null }), '联合模拟在选择策略时可以进行一次跳过；每位博士有 30 秒');
    assert.equal(draftTip({ timed: false, autoName: '华法琳' }), '联合模拟在选择策略时可以进行一次跳过；本局不限时');
  });

  test('a single human with AI teammates: the draft is untimed (soloUntimed), keeps the co-op order and its skip', () => {
    const h = draftOf({ humans: 1, bots: 3, seed: 4 });
    const m = h.m;
    h.run(() => m.draftTurn() === 'p_0' || m.phase !== PHASE.BAND_DRAFT, { maxTime: 1000 });
    assert.equal(m.draftTurn(), 'p_0');
    const pub = m.publicView();
    assert.equal(pub.deadline, 0);
    assert.equal(pub.draft.untimed, true);
    assert.equal(pub.draft.turnSeconds, 0);
    assert.equal(draftClock(pub), null);
    h.sched.advance(10 * 60_000);
    assert.equal(m.phase, PHASE.BAND_DRAFT, 'waits for the player');
    assert.equal(m.draftTurn(), 'p_0');
    if (m.draft.order.length - m.draft.idx > 1) assert.deepEqual(m.handle('p_0', { t: 'g.bandSkip' }), { ok: true }, 'the co-op skip stays');
    m.dispose();
  });
});
