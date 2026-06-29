// Probe: 920020 用东方财富数据复算 09:30~09:45 MACD HIST
// 关键：EM 1m 单次只回 240 条（当日），需要按交易日翻页凑预热深度。
const axios = require('axios');
const http = require('http');
const https = require('https');
const config = require('../config');
const { macd } = require('../indicators/macd');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://quote.eastmoney.com/',
  'Origin': 'https://quote.eastmoney.com',
};
const TIMEOUT = 25000;
const httpAgent = new http.Agent({ keepAlive: true, family: 4 });
const httpsAgent = new https.Agent({ keepAlive: true, family: 4 });

// 北交所在东财是 secid=0.xxxxxx
const SECID = '0.920020';
const HOSTS = [
  'https://push2his.eastmoney.com/api/qt/stock/kline/get',
  'https://60.push2his.eastmoney.com/api/qt/stock/kline/get',
  'https://19.push2his.eastmoney.com/api/qt/stock/kline/get',
];

function shiftToOpenSide(ts) {
  const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return ts;
  const [, Y, M, D, H, Min] = m;
  let h = parseInt(H, 10);
  let mi = parseInt(Min, 10) - 1;
  if (mi < 0) { mi += 60; h -= 1; }
  return `${Y}${M}${D}${String(h).padStart(2,'0')}${String(mi).padStart(2,'0')}`;
}

async function fetchEndDate(endYmd) {
  const params = {
    secid: SECID,
    ut: 'fa5fd1943c7b386f172d6893dbfba10b',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: 1,
    fqt: 1,
    end: endYmd,
    lmt: 240,
  };
  let lastErr = '';
  for (const url of HOSTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await axios.get(url, { params, headers: HEADERS, timeout: TIMEOUT, httpAgent, httpsAgent, validateStatus: () => true });
        if (r.status === 200 && r.data?.data?.klines && r.data.data.klines.length) {
          return { host: url, klines: r.data.data.klines };
        }
        lastErr = `status=${r.status} klines=${r.data?.data?.klines?.length}`;
      } catch (e) { lastErr = e.code || e.message; }
      await new Promise(rs => setTimeout(rs, 800 * (attempt + 1)));
    }
  }
  console.log(`  [debug] all hosts failed for end=${endYmd}, last=${lastErr}`);
  return null;
}

function prevYmd(ymd) {
  const Y = parseInt(ymd.slice(0,4),10), M = parseInt(ymd.slice(4,6),10)-1, D = parseInt(ymd.slice(6,8),10);
  const dt = new Date(Date.UTC(Y, M, D));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth()+1).padStart(2,'0')}${String(dt.getUTCDate()).padStart(2,'0')}`;
}

async function run() {
  const target = (process.argv[2] || '2026-06-24').replace(/-/g, '');
  const wantDays = 8;     // 预热深度（含 target 当日）
  let cursor = target;
  let allBars = [];
  const seenDates = new Set();
  let pages = 0;
  while (seenDates.size < wantDays && pages < wantDays + 4) {
    const got = await fetchEndDate(cursor);
    pages++;
    if (!got) { console.log(`  page end=${cursor}  FAIL`); break; }
    const bars = got.klines.map(line => {
      const p = String(line).split(',');
      return {
        ts: shiftToOpenSide(p[0]),
        open: parseFloat(p[1]),
        close: parseFloat(p[2]),
        high: parseFloat(p[3]),
        low: parseFloat(p[4]),
      };
    }).filter(b => Number.isFinite(b.close));
    if (!bars.length) break;
    // 这页覆盖的所有日期
    const dates = new Set(bars.map(b => b.ts.slice(0,8)));
    const newDates = [...dates].filter(d => !seenDates.has(d));
    if (!newDates.length) {
      // 翻页没拿到新数据 → 退一天
      cursor = prevYmd(cursor);
      continue;
    }
    for (const d of newDates) seenDates.add(d);
    // 合并去重
    const existingTs = new Set(allBars.map(b => b.ts));
    for (const b of bars) if (!existingTs.has(b.ts)) allBars.push(b);
    console.log(`  page ${pages} end=${cursor} via ${got.host.replace(/^https?:\/\//,'').split('/')[0]}  +${bars.length} bars  dates=${[...dates].join(',')}`);
    // 下一页：从这页最早日期再退一天
    const earliest = [...dates].sort()[0];
    cursor = prevYmd(earliest);
  }
  if (!allBars.length) { console.log('no EM data'); return; }

  // 按时间排序
  allBars.sort((a, b) => a.ts.localeCompare(b.ts));
  const dates = [...new Set(allBars.map(b => b.ts.slice(0,8)))].sort();
  console.log(`\nEM bars total = ${allBars.length}; dates (${dates.length}) = ${dates.join(', ')}`);
  console.log(`first=${allBars[0].ts}  last=${allBars[allBars.length-1].ts}`);

  const closes = allBars.map(b => b.close);
  const { dif, dea, hist } = macd(closes);

  const idxs = [];
  allBars.forEach((b, i) => {
    const d = b.ts.slice(0,8); const hm = b.ts.slice(8,12);
    if (d === target && hm >= '0930' && hm <= '0945') idxs.push(i);
  });
  if (!idxs.length) { console.log(`no bars for ${target} 0930~0945`); return; }

  console.log(`\n[EastMoney] Window ${target} 09:30~09:45 (${idxs.length} bars):`);
  console.log('time   close    DIF        DEA        HIST       color');
  for (const i of idxs) {
    const hm = allBars[i].ts.slice(8,12);
    console.log(
      `${hm.slice(0,2)}:${hm.slice(2)}  ${closes[i].toFixed(2).padStart(6)}  ` +
      `${dif[i].toFixed(4).padStart(9)}  ${dea[i].toFixed(4).padStart(9)}  ` +
      `${hist[i].toFixed(4).padStart(9)}  ${hist[i] > 0 ? 'RED' : 'GREEN'}`
    );
  }
  console.log(`\nHistory depth before window: ${idxs[0]} bars (≈ ${(idxs[0]/240).toFixed(2)} trading days)`);
}

run().catch(e => { console.error(e); process.exit(1); });
