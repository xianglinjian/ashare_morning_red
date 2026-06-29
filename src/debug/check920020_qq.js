// Probe: 920020 用腾讯（gtimg/qq）数据复算 09:30~09:45 MACD HIST
// 第三方数据源交叉验证 Sina 结果。
const axios = require('axios');
const config = require('../config');
const { macd } = require('../indicators/macd');
const { withPrefix } = require('../utils/codePrefix');

const HEADERS = config.httpHeaders;
const TIMEOUT = 20000;

async function fetchM1(symbol, count) {
  const url = `${config.dataSource.tencentKline}?param=${symbol},m1,,${count}`;
  const r = await axios.get(url, { headers: HEADERS, timeout: TIMEOUT, validateStatus: () => true });
  if (r.status !== 200 || !r.data?.data?.[symbol]) return null;
  return r.data.data[symbol].m1 || [];
}

async function run() {
  const target = (process.argv[2] || '2026-06-24').replace(/-/g, '');
  const code = '920020';
  const symbol = withPrefix(code); // bj920020

  // 尝试拉更大量级
  let rows = null;
  for (const cnt of [1500, 1320, 1000, 640, 320]) {
    rows = await fetchM1(symbol, cnt);
    if (rows && rows.length) { console.log(`Tencent ${symbol} cnt=${cnt} -> ${rows.length} rows`); break; }
  }
  if (!rows || !rows.length) { console.log('Tencent: no data'); return; }

  const bars = rows.map(r => ({
    ts: String(r[0]), // "yyyy-MM-dd HH:mm:00" open-side
    open: parseFloat(r[1]),
    close: parseFloat(r[2]),
    high: parseFloat(r[3]),
    low: parseFloat(r[4]),
  })).filter(b => Number.isFinite(b.close));

  // 转 12 位 ts
  function compact(ts) {
    const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    return m ? m[1]+m[2]+m[3]+m[4]+m[5] : ts;
  }
  bars.forEach(b => b.cts = compact(b.ts));

  const dates = [...new Set(bars.map(b => b.cts.slice(0,8)))].sort();
  console.log(`first=${bars[0].cts}  last=${bars[bars.length-1].cts}`);
  console.log(`dates (${dates.length}) = ${dates.join(', ')}`);

  const closes = bars.map(b => b.close);
  const { dif, dea, hist } = macd(closes);

  const idxs = [];
  bars.forEach((b, i) => {
    const d = b.cts.slice(0,8); const hm = b.cts.slice(8,12);
    if (d === target && hm >= '0930' && hm <= '0945') idxs.push(i);
  });
  if (!idxs.length) { console.log(`no bars for ${target} 0930~0945`); return; }

  console.log(`\n[Tencent] Window ${target} 09:30~09:45 (${idxs.length} bars):`);
  console.log('time   close    DIF        DEA        HIST       color');
  for (const i of idxs) {
    const hm = bars[i].cts.slice(8,12);
    console.log(
      `${hm.slice(0,2)}:${hm.slice(2)}  ${closes[i].toFixed(2).padStart(6)}  ` +
      `${dif[i].toFixed(4).padStart(9)}  ${dea[i].toFixed(4).padStart(9)}  ` +
      `${hist[i].toFixed(4).padStart(9)}  ${hist[i] > 0 ? 'RED' : 'GREEN'}`
    );
  }
  console.log(`\nHistory depth before window: ${idxs[0]} bars (≈ ${(idxs[0]/240).toFixed(2)} trading days)`);
}

run().catch(e => { console.error(e); process.exit(1); });
