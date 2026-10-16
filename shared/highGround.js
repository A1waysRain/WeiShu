// shared/highGround.js — which MELEE chess may stand on a 高台 (a ranged deploy tile).
//
// Owner's decision 2026-10-16: every 歌蕾蒂娅 variant may use a ranged tile,
// regardless of promotion or module. Other MELEE operators keep their existing ground-only rule.

/** char_474_glady — 歌蕾蒂娅. */
export const GLADIIA_CHAR_ID = 'char_474_glady';
/** HOK-Y 淡金坠饰 (data/chess.json chess_char_4_12_b.modules, typeName HOK-Y). */
export const GLADIIA_HOK_Y = 'uniequip_003_glady';

/**
 * @param {object|null} rec a chess record (normal or golden)
 * @param {string|null|undefined} moduleId retained for callers; placement no longer depends on it
 * @returns {boolean}
 */
export function meleeOnHighGround(rec, moduleId) {
  return !!(rec && rec.charId === GLADIIA_CHAR_ID);
}
