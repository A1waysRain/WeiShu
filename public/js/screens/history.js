import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from '../ui/components.js';
import { store, useStore } from '../store.js';
import { DIFFICULTY_NAMES } from '../../../shared/constants.js';
import { loadMatchHistory } from '../ui/matchHistory.js';
import { ResultView } from './result.js';

// Uses the app-wide UI slice, so opening a report never changes the live match.

export function HistoryButton({ size = 'sm', variant = 'secondary' } = {}) {
  return html`<${Button} size=${size} variant=${variant}
    onClick=${() => store.patch('ui', { historyOpen: true })}>历史对局<//>`;
}

export function HistoryHost() {
  const open = useStore((s) => !!s.ui.historyOpen);
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    if (open) { setRecords(loadMatchHistory()); setSelected(null); }
  }, [open]);
  const close = () => { setSelected(null); store.patch('ui', { historyOpen: false }); };
  if (!open) return null;
  return html`<${Modal} open=${true} title=${selected ? '历史对局详情' : '历史对局'}
      micro="最近 20 局 · 仅保存已结算对局" onClose=${selected ? () => setSelected(null) : close}
      class=${selected ? 'history-box history-box--detail' : 'history-box'} width=${selected ? '96vw' : '8rem'}
      actions=${html`<${Button} onClick=${close}>关闭<//>`}>
    ${selected ? html`<${ResultView} res=${selected.result} myId=${selected.myId} quiet=${true} onBack=${() => setSelected(null)} />`
      : records.length ? html`<div class="history-list">${records.map((record) => {
        const r = record.result;
        const me = r.players.find((p) => p.playerId === record.myId);
        return html`<button key=${record.id} type="button" class="history-row" onClick=${() => setSelected(record)}>
          <b class=${r.victory ? 'history-win' : 'history-loss'}>${r.victory ? '模拟完成' : '模拟失败'}</b>
          <span>${new Date(record.savedAt).toLocaleString()}</span>
          <span>${r.players.length > 1 ? '同盟模拟' : '独立模拟'} · ${DIFFICULTY_NAMES[r.difficulty] || r.difficulty || '—'} · 通过 ${me?.roundsPassed ?? r.roundsPassed} 回合</span>
          <span>${me?.name || '博士'} · ${r.durationMs == null ? '—' : Math.round(r.durationMs / 60000) + ' 分钟'} · 查看详情</span>
        </button>`;
      })}</div>` : html`<p>暂无历史对局。完成一局模拟后会自动保存结果。</p>`}
  <//>`;
}
