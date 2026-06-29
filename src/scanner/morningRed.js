'use strict';

/**
 * 早盘 9:31~9:45 MACD 全红柱筛选器：
 *   1. 拉 1m K 线（腾讯优先 → 新浪 → 东财兜底；bj 不走腾讯因实测返回空）
 *   2. 取目标日 09:31~09:45（含起止）共 15 根 bar（跳过 09:30 的 EMA 种子根）
 *   3. 用【当日】1m 序列计算 MACD(12,26,9)——EMA 从当日开盘 09:30 重新播种，
 *      与看盘 app 口径一致（app 的 1m MACD 当日起算，不复用前一日）
 *   4. 切出窗口内对应的 hist；要求每根 hist > 0（红柱）即命中
 */

const config = require('../config');
const tencent = require('../dataSource/tencentKline');
const sina = require('../dataSource/sinaKline');
const eastmoney = require('../dataSource/eastmoneyKline');
const { macd } = require('../indicators/macd');
const { getSymbolList } = require('../dataSource/symbolList');
const logger = require('../utils/logger');

const SOURCE_NAME = new Map([
    [sina, 'sina'],
    [tencent, 'tencent'],
    [eastmoney, 'eastmoney'],
]);

function newTally() {
    const t = {};
    for (const n of SOURCE_NAME.values()) t[n] = { ok: 0, empty: 0, err: 0 };
    return t;
}
let tally = newTally();

/** 涨停幅度（%）：主板10 / 科创板·创业板20 / 北交所30。 */
function limitPctOf(code) {
    if (!code || code.length < 6) return 10;
    const p2 = code.slice(0, 2);
    if (p2 === '68' || p2 === '30') return 20;
    if (p2 === '43' || p2 === '83' || p2 === '87' || p2 === '88' || p2 === '92') return 30;
    return 10;
}

/** 在 bars 中找出第一个属于目标日 09:30~09:45 的下标范围 [from, to]，闭区间 */
function findWindowRange(bars, dateStr) {
    const target = dateStr.replace(/-/g, '');
    const start = config.window.startHHMM;
    const end = config.window.endHHMM;
    let from = -1, to = -1;
    for (let i = 0; i < bars.length; i++) {
        const n = tencent.normalizeTs(bars[i].ts);
        if (!n) continue;
        if (n.date !== target) continue;
        if (n.hhmm < start || n.hhmm > end) continue;
        if (from === -1) from = i;
        to = i;
    }
    return { from, to };
}

/**
 * 拉 1m K 线（腾讯优先）：
 *   - bj：先 Sina，失败/空再东财（腾讯对 bj 实测返回空，故跳过）；
 *   - sh/sz：先腾讯，失败/空再 Sina，最后东财兜底。
 *   选腾讯优先：与东方财富等看盘 app 的 1m 数据一致（新浪开盘几分钟价格系统性偏差，
 *   会把 app 上的绿柱误算成红柱，见 603139 复核）。
 *   每个数据源单独记录结果（成功/空/异常）到日志与 tally，便于排查连接问题。
 */
async function fetchMinuteBars(item) {
    const sources = item.market === 'bj'
        ? [sina, eastmoney]
        : [tencent, sina, eastmoney];
    for (const src of sources) {
        const name = SOURCE_NAME.get(src);
        const t0 = Date.now();
        try {
            const bars = await src.get1mKline(item.code, 320);
            if (bars && bars.length) {
                tally[name].ok++;
                logger.debug(`[fetch] ${item.code} ${name} OK bars=${bars.length} ${Date.now() - t0}ms`);
                return bars;
            }
            tally[name].empty++;
            logger.debug(`[fetch] ${item.code} ${name} EMPTY ${Date.now() - t0}ms`);
        } catch (e) {
            tally[name].err++;
            logger.warn(`[fetch] ${item.code} ${name} FAIL ${e.code || ''} ${e.message}`);
        }
    }
    logger.warn(`[fetch] ${item.code} ALL_SOURCES_FAILED market=${item.market}`);
    return [];
}

/**
 * 对单只股票判定：返回 {hit:boolean, reason?, hist?, window?}
 */
async function evaluateOne(item, dateStr) {
    const bars = await fetchMinuteBars(item);
    if (!bars.length) return { hit: false, reason: 'no_bars' };

    const { from, to } = findWindowRange(bars, dateStr);
    if (from === -1) return { hit: false, reason: 'no_window' };
    const count = to - from + 1;
    if (count < 1) return { hit: false, reason: 'empty_window' };

    // 与看盘 app 口径一致：1m MACD 从当日开盘（09:30）重新播种 EMA，
    // 而非用前一交易日数据连续播种。当日数据从 09:30 第一根开始切片。
    const target = dateStr.replace(/-/g, '');
    let dayStart = 0;
    for (let i = 0; i < bars.length; i++) {
        const n = tencent.normalizeTs(bars[i].ts);
        if (n && n.date === target) { dayStart = i; break; }
    }
    const dayBars = bars.slice(dayStart);
    const closes = dayBars.map(b => b.close);
    const { hist } = macd(closes, 12, 26, 9);
    // hist 与 dayBars 一一对齐；窗口在当日内的相对下标
    const relFrom = from - dayStart;
    const relTo = to - dayStart;
    const slice = hist.slice(relFrom, relTo + 1);
    const window = dayBars.slice(relFrom, relTo + 1);

    // 严格：每根 hist > 0 才视为"全红"
    const allRed = slice.every(h => Number.isFinite(h) && h > 0);

    // 涨幅与涨停：以窗口末根（09:45）收盘 vs 前日尾盘收盘计算。
    const winLastClose = window[window.length - 1].close;
    const prevClose = dayStart > 0 ? bars[dayStart - 1].close : null;
    let gainPct = null;
    let isLimitUp = false;
    if (prevClose && prevClose > 0) {
        gainPct = (winLastClose - prevClose) / prevClose * 100;
        const limitPct = limitPctOf(item.code);
        const limitPrice = Math.round(prevClose * (1 + limitPct / 100) * 100) / 100;
        // 直接涨停：当日开盘即触及涨停，或窗口末根仍封死涨停（买不进）。
        const openAtLimit = dayBars.length > 0 && dayBars[0].open >= limitPrice - 0.01;
        const closeAtLimit = winLastClose >= limitPrice - 0.01;
        isLimitUp = openAtLimit || closeAtLimit;
    }

    const common = {
        bars: count,
        firstTs: window[0].ts,
        lastTs: window[window.length - 1].ts,
        minHist: slice.reduce((m, v) => (v < m ? v : m), Infinity),
        maxHist: slice.reduce((m, v) => (v > m ? v : m), -Infinity),
        hist: slice,
        gainPct,
    };

    if (!allRed) return { hit: false, reason: 'not_all_red', ...common };
    if (gainPct !== null && gainPct < config.filter.minGainPct) {
        return { hit: false, reason: 'low_gain', ...common };
    }
    if (config.filter.excludeLimitUp && isLimitUp) {
        return { hit: false, reason: 'limit_up', ...common };
    }
    return { hit: true, reason: 'ok', ...common };
}

/** 并发分批跑 */
async function runBatch(items, worker, batchSize) {
    const results = new Array(items.length);
    let cursor = 0;
    let done = 0;
    const total = items.length;
    async function next() {
        while (true) {
            const i = cursor++;
            if (i >= total) return;
            try {
                results[i] = await worker(items[i], i);
            } catch (e) {
                results[i] = { hit: false, reason: 'error', error: e.message };
            }
            done++;
            if (done % 100 === 0 || done === total) {
                logger.info(`[scan] 进度 ${done}/${total}`);
            }
        }
    }
    const workers = [];
    for (let k = 0; k < Math.min(batchSize, total); k++) workers.push(next());
    await Promise.all(workers);
    return results;
}

/**
 * 入口：扫描全市场，返回命中列表。
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {{refresh?: boolean, limit?: number}} [opts]
 */
async function scanMorningRed(dateStr, opts = {}) {
    const symbols = await getSymbolList({ refresh: !!opts.refresh });
    let pool = symbols;
    if (opts.limit && opts.limit > 0) pool = symbols.slice(0, opts.limit);
    tally = newTally();
    logger.info(`[scan] 待扫描股票数: ${pool.length}  目标日: ${dateStr}`);
    logger.info(`[scan] 日志文件: ${logger.logFile() || '(未创建)'}`);

    const t0 = Date.now();
    const results = await runBatch(pool, async (item) => {
        const r = await evaluateOne(item, dateStr);
        return { item, ...r };
    }, config.concurrency.batchSize);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const hits = results.filter(r => r.hit);
    const noBars = results.filter(r => r.reason === 'no_bars').length;
    const noWindow = results.filter(r => r.reason === 'no_window').length;
    const notAllRed = results.filter(r => r.reason === 'not_all_red').length;
    const lowGain = results.filter(r => r.reason === 'low_gain').length;
    const limitUp = results.filter(r => r.reason === 'limit_up').length;
    const errors = results.filter(r => r.reason === 'error').length;

    const sourceStats = Object.entries(tally)
        .map(([n, t]) => `${n}(ok=${t.ok} empty=${t.empty} err=${t.err})`).join('  ');
    logger.info(`[scan] 数据源: ${sourceStats}`);
    logger.info(`[scan] 完成 elapsed=${elapsed}s  hits=${hits.length}  notAllRed=${notAllRed}  lowGain=${lowGain}  limitUp=${limitUp}  noBars=${noBars}  noWindow=${noWindow}  errors=${errors}`);
    return { hits, stats: { total: pool.length, hits: hits.length, notAllRed, lowGain, limitUp, noBars, noWindow, errors, elapsedSec: parseFloat(elapsed), source: tally } };
}

module.exports = { scanMorningRed, evaluateOne, fetchMinuteBars, runBatch };
