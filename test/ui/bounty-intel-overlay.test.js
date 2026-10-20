import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

test('bounty enemy intel and its detail panel escape the HUD stacking context', () => {
  const game = read('public/js/screens/game.js');
  const hud = game.indexOf('<div class="gm__hud"');
  const drawer = game.indexOf('${drawer ? html`<${EnemyDrawer}', hud);
  const hudEnd = game.lastIndexOf('\n    </div>\n\n', drawer);
  const detail = game.indexOf('${resolved ? html`<${DetailPanel}', drawer);
  const choice = game.indexOf('${sp ? html`<${ChoiceOverlay}', detail);
  assert.ok(hud >= 0 && hudEnd > hud && drawer > hudEnd, 'the enemy drawer is a sibling of the HUD');
  assert.ok(detail > drawer && choice > detail, 'the enemy detail panel is also outside the HUD');

  const css = read('public/css/screens/game-panels.css');
  assert.match(css, /\.gm\.has-spdraft > \.edrawer, \.gm\.has-spdraft > \.dpanel \{ z-index: 25; \}/,
    'both intel panels render above the choice overlay');
});
