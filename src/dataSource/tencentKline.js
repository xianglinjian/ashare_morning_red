'use strict';

/**
 * 腾讯 1m K 线（无鉴权）：
 *   https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh600000,m1,,320
 *   data[symbol].m1 = [["yyyy-MM-dd HH:mm:00", open, close, high, low, vol], ...]
 * 时间戳为 open-side（09:30 表示 09:30→09:31）。
 */

const axios = require('axios');
const config = require('../config');
const { withPrefix } = require('../utils/codePrefix');

const HEADERS = config.httpHeaders;
const TIMEOUT = config.concurrency.requestTimeoutMs;

function normalizeMinuteRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(r => ({
        ts: r[0],
        open: parseFloat(r[1]),
        close: parseFloat(r[2]),
        high: parseFloat(r[3]),
        low: parseFloat(r[4]),
        vol: parseFloat(r[5] || 0),
    })).filter(r => Number.isFinite(r.close));
}

/** 把 ts 拆为 {date:'YYYYMMDD', hhmm:'HHMM'}，无法识别返回 null。 */
function normalizeTs(ts) {
    if (!ts) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(ts)) {
        const m = ts.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        if (!m) return null;
        return { date: m[1] + m[2] + m[3], hhmm: m[4] + m[5] };
    }
    if (/^\d{12}$/.test(ts)) return { date: ts.slice(0, 8), hhmm: ts.slice(8, 12) };
    return null;
}

/** 取指定交易日 09:30~09:45（含起止）的早盘段 */
function sliceMorningOpen(bars, dateStr) {
    if (!bars || !bars.length) return [];
    const target = dateStr.replace(/-/g, '');
    const startHHMM = config.window.startHHMM;
    const endHHMM = config.window.endHHMM;
    const out = [];
    for (const b of bars) {
        const n = normalizeTs(b.ts);
        if (!n) continue;
        if (n.date !== target) continue;
        if (n.hhmm < startHHMM) continue;
        if (n.hhmm > endHHMM) continue;
        out.push(b);
    }
    return out;
}

/** 获取 1m K 线（默认 320 根 ≈ 1.3 个交易日） */
async function get1mKline(code, count = 320) {
    const symbol = withPrefix(code);
    const url = `${config.dataSource.tencentKline}?param=${symbol},m1,,${count}`;
    const resp = await axios.get(url, { headers: HEADERS, timeout: TIMEOUT });
    const data = resp.data;
    if (!data || !data.data || !data.data[symbol]) return [];
    const rows = data.data[symbol].m1 || [];
    return normalizeMinuteRows(rows);
}

module.exports = { get1mKline, sliceMorningOpen, normalizeTs };
