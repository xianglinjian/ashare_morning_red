// Probe: 920020 09:30~09:45 MACD HIST via Xueqiu (independent third-party check)
const https = require('https');
const { macd } = require('../indicators/macd');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function req(url, cookie) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method: 'GET',
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Referer: 'https://xueqiu.com/',
        Origin: 'https://xueqiu.com',
      },
      timeout: 15000,
    };
    if (cookie) opts.headers.Cookie = cookie;
    const r = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.end();
  });
}

async function getCookie() {
  // Visit a sequence of pages; each hop accumulates cookies.
  const jar = {};
  const visit = async (url, refCookie) => {
    const r = await req(url, refCookie);
    const setCookies = r.headers['set-cookie'] || [];
    for (const sc of setCookies) {
      const [pair] = sc.split(';');
      const [k, v] = pair.split('=');
      if (k && v) jar[k.trim()] = v.trim();
    }
    return r;
  };
  const buildCookie = () =>
    Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

  await visit('https://xueqiu.com/');
  await visit('https://xueqiu.com/S/BJ920020', buildCookie());
  // explicit hub-page that often sets xq_a_token
  await visit('https://xueqiu.com/hq', buildCookie());
  return buildCookie();
}

async function fetchKline(symbol, beginMs, count, cookie) {
  const url =
    `https://stock.xueqiu.com/v5/stock/chart/kline.json` +
    `?symbol=${symbol}&begin=${beginMs}&period=1m&type=before&count=${count}&indicator=kline`;
  const r = await req(url, cookie);
  if (r.status !== 200) {
    throw new Error(`xq status=${r.status} body=${r.body.slice(0, 200)}`);
  }
  const j = JSON.parse(r.body);
  if (j.error_code) throw new Error(`xq error: ${JSON.stringify(j)}`);
  return j.data;
}

async function run() {
  const target = (process.argv[2] || '2026-06-24').replace(/-/g, ''); // YYYYMMDD
  const symbol = 'BJ920020';

  console.log('[xq] getting cookie…');
  const cookie = await getCookie();
  console.log(`[xq] cookie keys: ${cookie.split(';').map(s => s.split('=')[0].trim()).join(',')}`);

  // begin = end of target day (CST). Xueqiu uses ms since epoch.
  // 2026-06-24 16:00 CST = 2026-06-24 08:00 UTC
  const yyyy = Number(target.slice(0, 4));
  const mm = Number(target.slice(4, 6));
  const dd = Number(target.slice(6, 8));
  const beginMs = Date.UTC(yyyy, mm - 1, dd, 8, 0, 0); // 16:00 CST

  console.log(`[xq] fetch ${symbol} begin=${new Date(beginMs).toISOString()} count=-1500`);
  let data;
  try {
    data = await fetchKline(symbol, beginMs, -1500, cookie);
  } catch (e) {
    console.error(`[xq] negative-count fetch failed: ${e.message}`);
    // try positive going forward with earlier begin
    const earlierBegin = beginMs - 12 * 24 * 3600 * 1000;
    console.log(`[xq] retry with begin=${new Date(earlierBegin).toISOString()} count=1500`);
    data = await fetchKline(symbol, earlierBegin, 1500, cookie);
  }

  if (!data || !data.item || !data.item.length) {
    console.log('[xq] no items');
    console.log(JSON.stringify(data, null, 2).slice(0, 400));
    return;
  }

  const col = data.column || [];
  const tsIdx = col.indexOf('timestamp');
  const closeIdx = col.indexOf('close');
  console.log(`[xq] columns: ${col.join(',')}; rows=${data.item.length}`);

  // Map to bars with CST ts string YYYYMMDDHHMM
  const bars = data.item
    .map((row) => {
      const ts = row[tsIdx];
      const close = Number(row[closeIdx]);
      const d = new Date(ts + 8 * 3600 * 1000); // shift UTC→CST then read UTC fields
      const yy = d.getUTCFullYear().toString().padStart(4, '0');
      const mo = (d.getUTCMonth() + 1).toString().padStart(2, '0');
      const da = d.getUTCDate().toString().padStart(2, '0');
      const hh = d.getUTCHours().toString().padStart(2, '0');
      const mi = d.getUTCMinutes().toString().padStart(2, '0');
      return { tsRaw: ts, ts: `${yy}${mo}${da}${hh}${mi}`, close };
    })
    .filter((b) => Number.isFinite(b.close));

  bars.sort((a, b) => a.tsRaw - b.tsRaw);

  const dates = [...new Set(bars.map((b) => b.ts.slice(0, 8)))];
  console.log(`[xq] bars=${bars.length}; dates=${dates.join(',')}`);

  const closes = bars.map((b) => b.close);
  const { dif, dea, hist } = macd(closes);

  const idxs = [];
  bars.forEach((b, i) => {
    const d = b.ts.slice(0, 8);
    const hm = b.ts.slice(8, 12);
    if (d === target && hm >= '0930' && hm <= '0945') idxs.push(i);
  });

  if (!idxs.length) {
    console.log(`no bars for ${target} 0930~0945`);
    // show last 5 ts
    console.log('last bars:', bars.slice(-5).map((b) => b.ts).join(','));
    return;
  }

  console.log(`\nXueqiu window ${target} 09:30~09:45 (${idxs.length} bars):`);
  console.log('time   close    DIF        DEA        HIST       color');
  for (const i of idxs) {
    const hm = bars[i].ts.slice(8, 12);
    console.log(
      `${hm.slice(0, 2)}:${hm.slice(2)}  ${closes[i].toFixed(2).padStart(6)}  ` +
        `${dif[i].toFixed(4).padStart(9)}  ${dea[i].toFixed(4).padStart(9)}  ` +
        `${hist[i].toFixed(4).padStart(9)}  ${hist[i] > 0 ? 'RED' : 'GREEN'}`
    );
  }
  console.log(`\nHistory depth before window: ${idxs[0]} bars (≈ ${(idxs[0] / 240).toFixed(2)} trading days)`);
}

run().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
