'use strict';

/** 把任意输入归一化为 'YYYY-MM-DD'（北京时间），缺省则用今天。 */
function normalizeDate(input) {
    if (input) {
        const s = String(input).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
        const d = new Date(s);
        if (!isNaN(d.getTime())) return formatBeijing(d);
        throw new Error(`无法解析日期: ${input}`);
    }
    return formatBeijing(new Date());
}

/** 把 Date 按北京时间（UTC+8）格式化为 'YYYY-MM-DD' */
function formatBeijing(date) {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    const bj = new Date(utc + 8 * 3600 * 1000);
    const y = bj.getUTCFullYear();
    const m = String(bj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(bj.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** 解析 CLI 参数：--date=YYYY-MM-DD / 位置日期；--limit=N；--mode=auto|live|backtest；--pool-limit=N */
function parseCliArgs(argv) {
    const args = { date: null, limit: 0, mode: 'auto', poolLimit: 0 };
    for (const a of argv.slice(2)) {
        const m = a.match(/^--date=(.+)$/);
        if (m) { args.date = m[1]; continue; }
        const ml = a.match(/^--limit=(\d+)$/);
        if (ml) { args.limit = parseInt(ml[1], 10); continue; }
        const mm = a.match(/^--mode=(auto|live|backtest)$/);
        if (mm) { args.mode = mm[1]; continue; }
        const mp = a.match(/^--pool-limit=(\d+)$/);
        if (mp) { args.poolLimit = parseInt(mp[1], 10); continue; }
        if (/^\d{4}-\d{2}-\d{2}$/.test(a) || /^\d{8}$/.test(a)) {
            args.date = a;
        }
    }
    return args;
}

module.exports = { normalizeDate, formatBeijing, parseCliArgs };
