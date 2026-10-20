// Explicit local rules applied after importing/building upstream generated records.
export function projectBands(bands) {
  const band = bands.band_jesica;
  if (!band || band.buffs?.some((b) => b.key === 'band_after_shop_level_refresh_guarantee')) return bands;
  const extra = '；调度中心升至4级后累计主动刷新首次达到10次时，下一次主动刷新必定出现1名普通4阶魔王（每局一次，免费刷新计入次数）';
  return { ...bands, band_jesica: { ...band,
    desc: band.desc.replace('\n', extra + '\n'),
    descRaw: band.descRaw.replace('\n', extra + '\n'),
    buffs: [...band.buffs, { key: 'band_after_shop_level_refresh_guarantee', bb: { level: 4, refresh_count: 10 }, bbStr: { chess: 'chess_char_4_25_a' } }],
  } };
}
