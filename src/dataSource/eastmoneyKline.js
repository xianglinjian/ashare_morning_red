'use strict';

/**
 * 东方财富 1m K 线（无鉴权），作为腾讯接口对北交所（bj）等的 fallback。
 *   https://push2his.eastmoney.com/api/qt/stock/kline/get
 *
 * 东财 1m 时间戳是 close-side（09:31 表示 09:30→09:31），上层按 open-side 命中 09:30，
 * 因此在 normalize 阶段把 hhmm 减 1 分钟，统一为 open-side。
 */

const axios = require('axios');
const config = require('../config');

const HEADERS = config.httpHeaders;
const TIMEOUT = config.concurrency.requestTimeoutMs;
const BASE_URL = config.dataSource.eastmoneyKline;

function toSecid(code) {
    if (!code || code.length < 6) return null;
    const p2 = code.slice(0, 2);
    if (p2 === '60' || p2 === '68' || p2 === '11' || p2 === '13' || p2 === '90') return `1.${code}`;
    return `0.${code}`;
}

function shiftToOpenSide(ts) {
    const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    if (!m) return ts;
    const [, Y, M, D, H, Min] = m;
    let h = parseInt(H, 10);
    let mi = parseInt(Min, 10) - 1;
    if (mi < 0) { mi += 60; h -= 1; }
    if (h < 0) { h = 0; mi = 0; }
    return `${Y}-${M}-${D} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00`;
}

function normalizeMinuteRows(klines, shift) {
    if (!Array.isArray(klines)) return [];
    const out = [];
    for (const line of klines) {
        const parts = String(line).split(',');
        if (parts.length < 6) continue;
        const ts = shift ? shiftToOpenSide(parts[0]) : parts[0];
        const open = parseFloat(parts[1]);
        const close = parseFloat(parts[2]);
        const high = parseFloat(parts[3]);
        const low = parseFloat(parts[4]);
        const vol = parseFloat(parts[5] || 0);
        if (!Number.isFinite(close)) continue;
        out.push({ ts, open, close, high, low, vol });
    }
    return out;
}

async function get1mKline(code, count = 320) {
    const secid = toSecid(code);
    if (!secid) return [];
    const params = {
        secid,
        ut: 'fa5fd1943c7b386f172d6893dbfba10b',
        fields1: 'f1,f2,f3,f4,f5,f6',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
        klt: 1,
        fqt: 1,
        end: '20500101',
        lmt: count,
    };
    const resp = await axios.get(BASE_URL, {
        params,
        headers: HEADERS,
        timeout: TIMEOUT,
        validateStatus: () => true,
    });
    if (resp.status !== 200) return [];
    const data = resp.data;
    if (!data || !data.data || !Array.isArray(data.data.klines)) return [];
    return normalizeMinuteRows(data.data.klines, true);
}

module.exports = { get1mKline };
