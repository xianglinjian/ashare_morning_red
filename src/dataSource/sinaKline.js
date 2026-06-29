'use strict';

/**
 * 新浪 1m K 线（无鉴权，全市场覆盖：sh/sz/bj）：
 *   https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_kl_=/CN_MarketDataService.getKLineData
 *     ?symbol=sh600000&scale=1&ma=no&datalen=320
 * 返回形如：
 *   /* ...some prefix... *\/ var _kl_=([{day:"YYYY-MM-DD HH:mm:00", open, high, low, close, volume, amount}, ...]);
 *
 * 时间戳约定（实测）：新浪 1m K 线以 close-side 标注：
 *   09:30 开盘后第一根记为 2026-06-24 09:31:00
 *   09:31~09:32 记为 09:32:00 …… 因此“09:30~09:45 含起止”对应 Sina ts ∈ [09:31, 09:46]。
 * 为与项目其它部分保持一致（统一按 open-side 比较窗口），这里把 ts 整体回移 1 分钟（-1m）。
 */

const axios = require('axios');
const config = require('../config');
const { withPrefix } = require('../utils/codePrefix');

const HEADERS = config.httpHeaders;
const TIMEOUT = config.concurrency.requestTimeoutMs;

/** 把 "YYYY-MM-DD HH:mm:00" 回移 1 分钟，输出 "YYYYMMDDHHmm"（open-side） */
function shiftToOpenSide(day) {
    const m = String(day).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    if (!m) return null;
    const t = new Date(
        Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
    );
    t.setUTCMinutes(t.getUTCMinutes() - 1);
    const pad = (n) => String(n).padStart(2, '0');
    return (
        t.getUTCFullYear().toString() +
        pad(t.getUTCMonth() + 1) +
        pad(t.getUTCDate()) +
        pad(t.getUTCHours()) +
        pad(t.getUTCMinutes())
    );
}

function parseSinaPayload(text) {
    if (!text) return [];
    const s = String(text);
    // 形如：/*...*/ var _xxx=([{...},{...}]);  也可能没有外层括号
    let start = s.indexOf('[');
    let end = s.lastIndexOf(']');
    if (start < 0 || end < 0 || end <= start) return [];
    let body = s.slice(start, end + 1);
    // 新浪返回的是非严格 JSON，键无引号，先修复
    body = body.replace(/([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    try {
        return JSON.parse(body);
    } catch (_) {
        return [];
    }
}

function normalizeRows(rows) {
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (const r of rows) {
        const ts = shiftToOpenSide(r.day);
        if (!ts) continue;
        const close = parseFloat(r.close);
        if (!Number.isFinite(close)) continue;
        out.push({
            ts,
            open: parseFloat(r.open),
            close,
            high: parseFloat(r.high),
            low: parseFloat(r.low),
            vol: parseFloat(r.volume || 0),
        });
    }
    return out;
}

/** 获取 1m K 线（默认 320 根 ≈ 1.3 个交易日） */
async function get1mKline(code, count = 320) {
    const symbol = withPrefix(code);
    const url = `${config.dataSource.sinaKline}?symbol=${symbol}&scale=1&ma=no&datalen=${count}`;
    const resp = await axios.get(url, {
        headers: HEADERS,
        timeout: TIMEOUT,
        responseType: 'text',
        transformResponse: [(d) => d],
    });
    const rows = parseSinaPayload(resp.data);
    return normalizeRows(rows);
}

module.exports = { get1mKline, shiftToOpenSide };
