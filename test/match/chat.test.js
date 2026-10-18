import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateC2S, S2C } from '../../shared/protocol.js';
import { CHAT_MAX_LENGTH, CHAT_COOLDOWN_MS, CHAT_BUBBLE_MS } from '../../shared/chat.js';
import { EMOTES, ERR } from '../../shared/constants.js';
import { activeBubbles, shortcutFor } from '../../public/js/ui/gameLogic.js';
import { makeMatch } from './harness.js';

test('text chat validates empty, oversized and non-text messages at the protocol boundary', () => {
  assert.equal(validateC2S({ t: 'g.chat', text: '队友先选，我来联防' }), null);
  assert.equal(validateC2S({ t: 'g.chat', text: '中'.repeat(CHAT_MAX_LENGTH) }), null);
  for (const text of ['', ' \n\t ', '\u0000', '中'.repeat(CHAT_MAX_LENGTH + 1), null, 12]) {
    assert.ok(validateC2S({ t: 'g.chat', text }));
  }
  assert.ok(S2C.includes('m.chat'));
});

for (const humans of [2, 6, 10]) test(`${humans} players: broadcast text with authenticated sender, room isolation and independent cooldown`, () => {
  const h = makeMatch({ mode: humans === 10 ? 'coop10' : 'coop', humans, fake: true }).start();
  const otherRoom = makeMatch({ mode: 'solo', humans: 1, fake: true }).start();
  try {
    const m = h.m;
    assert.deepEqual(m.handle('p_0', { t: 'g.chat', playerId: 'p_1', text: '  等我\n 一下  ' }), { ok: true });
    assert.deepEqual(h.lastBc('m.chat'), { t: 'm.chat', playerId: 'p_0', text: '等我 一下' });
    assert.equal(otherRoom.bc.filter((x) => x.t === 'm.chat').length, 0);
    assert.equal(m.handle('p_0', { t: 'g.chat', text: '连续发送' }).error, ERR.RATE);
    assert.deepEqual(m.handle('p_1', { t: 'g.chat', text: '收到' }), { ok: true });
    assert.equal(h.lastBc('m.chat').playerId, 'p_1');
    assert.deepEqual(m.handle('p_0', { t: 'g.emote', id: EMOTES[0] }), { ok: true });
    assert.equal(m.handle('unknown', { t: 'g.chat', text: 'test' }).error, ERR.NOT_IN_ROOM);
    for (const text of ['', ' ', 'x'.repeat(CHAT_MAX_LENGTH + 1)]) assert.equal(m.handle('p_1', { t: 'g.chat', text }).error, ERR.BAD_MSG);
    h.sched.advance(CHAT_COOLDOWN_MS);
    const literal = '<img src=x onerror=alert(1)>';
    assert.deepEqual(m.handle('p_0', { t: 'g.chat', text: literal }), { ok: true });
    assert.equal(h.lastBc('m.chat').text, literal, 'broadcast plain text; no HTML generation');
  } finally { h.m.dispose(); otherRoom.m.dispose(); }
});

test('avatar bubbles show each sender’s latest message and expire without reviving an older bubble', () => {
  const events = [
    { seq: 1, playerId: 'a', text: '准备好了', at: 1000 },
    { seq: 2, playerId: 'b', text: '正在整备', at: 1000 },
    { seq: 3, playerId: 'a', id: EMOTES[0], at: 1100 },
  ];
  const bubbles = activeBubbles(events, 1200);
  assert.equal(bubbles.get('a').id, EMOTES[0]);
  assert.equal(bubbles.get('b').text, '正在整备');
  assert.equal(activeBubbles(events, 4200).has('a'), false, 'expired emote must not reveal the previous text');
  assert.equal(activeBubbles(events, 4200).has('b'), true, 'text gets more reading time');
  assert.equal(activeBubbles(events, 1000 + CHAT_BUBBLE_MS).size, 0);
  assert.equal(shortcutFor({ key: 'r', target: { tagName: 'INPUT' } }), null, 'typing does not refresh the shop');
  assert.equal(shortcutFor({ key: ' ', target: { tagName: 'INPUT' } }), null, 'typing does not ready/pause');
});
