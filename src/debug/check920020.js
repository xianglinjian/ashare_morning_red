// Probe: 920020 泰凯英  09:30~09:45 MACD HIST reality check
const { get1mKline } = require('../dataSource/sinaKline');
const { macd } = require('../indicators/macd');

async function run() {
  const code = '920020';                    // withPrefix() adds 'bj'
  const target = (process.argv[2] || '2026-06-24').replace(/-/g, ''); // -> YYYYMMDD

  const bars = await get1mKline(code, 1500);
  console.log(`pulled ${bars.length} bars; first=${bars[0]?.ts} last=${bars[bars.length-1]?.ts}`);
  if (!bars.length) return;

  const closes = bars.map(b => Number(b.close));
  const { dif, dea, hist } = macd(closes);

  // available trading dates
  const dates = [...new Set(bars.map(b => b.ts.slice(0, 8)))];
  console.log(`available dates: ${dates.join(', ')}`);

  // 09:30~09:45 window for target
  const idxs = [];
  bars.forEach((b, i) => {
    const d = b.ts.slice(0, 8);
    const hm = b.ts.slice(8, 12);
    if (d === target && hm >= '0930' && hm <= '0945') idxs.push(i);
  });

  if (!idxs.length) {
    console.log(`no bars for ${target} 0930~0945`);
    return;
  }

  console.log(`\nWindow ${target} 09:30~09:45 (${idxs.length} bars):`);
  console.log('time   close    DIF        DEA        HIST       color');
  for (const i of idxs) {
    const hm = bars[i].ts.slice(8, 12);
    console.log(
      `${hm.slice(0,2)}:${hm.slice(2)}  ${closes[i].toFixed(2).padStart(6)}  ` +
      `${dif[i].toFixed(4).padStart(9)}  ${dea[i].toFixed(4).padStart(9)}  ` +
      `${hist[i].toFixed(4).padStart(9)}  ${hist[i] > 0 ? 'RED' : 'GREEN'}`
    );
  }

  console.log(`\nHistory depth before window: ${idxs[0]} bars (≈ ${(idxs[0] / 240).toFixed(2)} trading days)`);

  // sanity: re-compute with only the previous day's 240 bars + this morning to see if
  // EMA cold-start matters. We feed the FULL 1500 vs a TRUNCATED slice starting from
  // the day before target.
  const dayIdxStart = bars.findIndex(b => b.ts.startsWith(target));
  if (dayIdxStart >= 0) {
    // truncated = last full day before target + target morning
    const prevStart = Math.max(0, dayIdxStart - 240);
    const tClose = bars.slice(prevStart).map(b => Number(b.close));
    const t = macd(tClose);
    console.log(`\nTruncated MACD (slice ${prevStart}..end, ${tClose.length} bars) on same window:`);
    for (const i of idxs) {
      const j = i - prevStart;
      const hm = bars[i].ts.slice(8, 12);
      console.log(`  ${hm.slice(0,2)}:${hm.slice(2)}  HIST=${t.hist[j].toFixed(4)} ${t.hist[j] > 0 ? 'RED' : 'GREEN'}`);
    }
  }
}

run().catch(e => { console.error(e); process.exit(1); });
