'use strict';

/**
 * 红柱恢复（R-G-R）扫描器：
 *   在早盘 09:31~09:45 全红池里，09:45 之后继续监控"红-绿-红"恢复结构。
 *     Phase1 早盘红（池成员隐式成立，取其 ΣHIST 作红面积）
 *     → Phase2 抛压绿（0945 后第一段连续绿柱，长度≥minGreenRun）
 *     → Phase3 恢复红（Phase2 后第一段连续红柱，长度≥minRedRun）
 *   命中 = Phase2、Phase3 均达标 且 红面积(Phase1)/绿面积(Phase2) ≥ minAreaRatio（默认 2）。
 *
 * 复用 morningRed 的 fetchMinuteBars/runBatch、tencentKline 的 normalizeTs、
 * 以及"09:30 重播种 MACD"的同一口径（与看盘 app 一致），保证与早盘扫描口径完全相同。
 */

const config = require('../config');
const tencent = require('../dataSource/tencentKline');
const { macd } = require('../indicators/macd');
const { fetchMinuteBars, runBatch } = require('./morningRed');
const logger = require('../utils/logger');

const WIN_START = config.window.startHHMM; // '0931'
const WIN_END = config.window.endHHMM;     // '0945'（Phase1 末根）
const REC = config.recovery;

/**
 * 在 bars 中找出目标日 [startHHMM, endHHMM]（含起止）的下标范围，闭区间。
 * endHHMM 为空时不设上界（取到当日最后一根）。
 */
function findRange(bars, dateStr, startHHMM, endHHMM) {
    const target = dateStr.replace(/-/g, '');
    let from = -1, to = -1;
    for (let i = 0; i < bars.length; i++) {
        const n = tencent.normalizeTs(bars[i].ts);
        if (!n || n.date !== target) continue;
        if (n.hhmm < startHHMM) continue;
        if (endHHMM && n.hhmm > endHHMM) continue;
        if (from === -1) from = i;
        to = i;
    }
    return { from, to };
}

/**
 * 纯函数：在窗口 HIST 上检测 R-G-R（便于单测，回测/实时共用）。
 * @param {number[]} histWindow  从 0931 起到截止时刻的 HIST（histWindow[0]=0931）
 * @param {{phase1Len:number, minGreenRun:number, minRedRun:number}} opts
 * @returns {{hit,greenRunLen,redRunLen,redArea1,greenArea,areaRatio,confirmIdx}}
 */
function detectRGR(histWindow, opts) {
    const { phase1Len, minGreenRun, minRedRun } = opts;
    const phase1 = histWindow.slice(0, phase1Len);
    const redArea1 = phase1.reduce((s, h) => s + (h > 0 ? h : 0), 0);

    const rest = histWindow.slice(phase1Len); // 0945 之后

    // Phase2：第一段连续绿柱（HIST<0），长度≥minGreenRun；零星短绿柱跳过
    let i = 0, p2Start = -1, p2End = -1;
    while (i < rest.length) {
        if (rest[i] < 0) {
            let j = i;
            while (j < rest.length && rest[j] < 0) j++;
            if (j - i >= minGreenRun) { p2Start = i; p2End = j - 1; break; }
            i = j;
        } else i++;
    }
    if (p2Start === -1) {
        return { hit: false, greenRunLen: 0, redRunLen: 0, redArea1, greenArea: 0, areaRatio: null, confirmIdx: -1 };
    }
    const greenRun = rest.slice(p2Start, p2End + 1);
    const greenArea = Math.abs(greenRun.reduce((s, h) => s + h, 0));

    // Phase3：Phase2 后第一段连续红柱（HIST>0），长度≥minRedRun；短红柱跳过
    let k = p2End + 1, p3Start = -1, p3End = -1;
    while (k < rest.length) {
        if (rest[k] > 0) {
            let j = k;
            while (j < rest.length && rest[j] > 0) j++;
            if (j - k >= minRedRun) { p3Start = k; p3End = j - 1; break; }
            k = j;
        } else k++;
    }
    if (p3Start === -1) {
        return { hit: false, greenRunLen: greenRun.length, redRunLen: 0, redArea1, greenArea, areaRatio: null, confirmIdx: -1 };
    }
    const redRunLen = p3End - p3Start + 1;
    // 确认时刻 = Phase3 第 minRedRun 根红柱（达到阈值即成立）
    const confirmIdx = phase1Len + p3Start + minRedRun - 1;
    const hit = redArea1 > greenArea;
    const areaRatio = greenArea > 0 ? redArea1 / greenArea : null;
    return { hit, greenRunLen: greenRun.length, redRunLen, redArea1, greenArea, areaRatio, confirmIdx };
}

/**
 * 对池中单只股票判定 R-G-R。
 * @param {object} item 股票 {code,name,market}
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {{uptoHHMM?:string, minGreenRun?:number, minRedRun?:number, minAreaRatio?:number}} [opts]
 */
async function evaluateRecovery(item, dateStr, opts = {}) {
    const uptoHHMM = opts.uptoHHMM || REC.endHHMM;
    const minGreenRun = opts.minGreenRun || REC.minGreenRun;
    const minRedRun = opts.minRedRun || REC.minRedRun;
    const minAreaRatio = opts.minAreaRatio != null ? opts.minAreaRatio : REC.minAreaRatio;

    const bars = await fetchMinuteBars(item);
    if (!bars.length) return { hit: false, reason: 'no_bars' };

    const target = dateStr.replace(/-/g, '');

    // 当日起点（09:30 第一根），与 morningRed 同口径
    let dayStart = 0;
    for (let i = 0; i < bars.length; i++) {
        const n = tencent.normalizeTs(bars[i].ts);
        if (n && n.date === target) { dayStart = i; break; }
    }
    const dayBars = bars.slice(dayStart);
    const closes = dayBars.map(b => b.close);
    const { hist } = macd(closes, 12, 26, 9);

    // Phase1 范围 0931~0945（池成员必为全红）；恢复扫描范围 0931~uptoHHMM
    const p1 = findRange(bars, dateStr, WIN_START, WIN_END);
    const cut = findRange(bars, dateStr, WIN_START, uptoHHMM);
    if (p1.from === -1 || cut.from === -1) return { hit: false, reason: 'no_window' };

    const relFrom = cut.from - dayStart;
    const relTo = cut.to - dayStart;
    const phase1Len = p1.to - p1.from + 1;
    const histWindow = hist.slice(relFrom, relTo + 1);
    if (histWindow.length < phase1Len) return { hit: false, reason: 'short_window' };

    const r = detectRGR(histWindow, { phase1Len, minGreenRun, minRedRun });
    if (!r.hit) {
        const reason = r.confirmIdx === -1
            ? (r.greenRunLen === 0 ? 'no_phase2' : 'no_phase3')
            : 'area_too_small';
        return { ...r, hit: false, reason };
    }
    // 做多力度门槛：红/绿面积比须 ≥ minAreaRatio，否则视为红方动能不足而过滤。
    // 注意 hit/reason 必须放在展开之后，否则会被 r 里的 hit:true 覆盖。
    if (r.areaRatio == null || r.areaRatio < minAreaRatio) {
        return { ...r, hit: false, reason: 'area_too_small' };
    }

    // 确认时刻 HHMM
    const confirmBar = dayBars[relFrom + r.confirmIdx];
    const confirmHHMM = confirmBar ? tencent.normalizeTs(confirmBar.ts).hhmm : '';

    // 截止时刻涨幅（前日尾盘 vs 扫描截止根收盘）
    const prevClose = dayStart > 0 ? bars[dayStart - 1].close : null;
    const curClose = dayBars[relTo] ? dayBars[relTo].close : null;
    const currentGainPct = (prevClose && curClose) ? (curClose - prevClose) / prevClose * 100 : null;

    // 当日最终收盘涨幅（前日尾盘 vs 当日最后一根收盘，用于收盘后回测/回放对比效果）
    const lastBar = dayBars.length ? dayBars[dayBars.length - 1] : null;
    const finalClose = lastBar ? lastBar.close : null;
    const finalGainPct = (prevClose && finalClose) ? (finalClose - prevClose) / prevClose * 100 : null;

    return { hit: true, reason: 'ok', ...r, confirmHHMM, currentGainPct, finalGainPct };
}

/**
 * 入口：对池批量扫描 R-G-R。
 * @param {Array} pool 早盘命中池（scanMorningRed 的 hits，每项含 item/code/name/market/gainPct...）
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {{mode?:string, uptoHHMM?:string, minGreenRun?:number, minRedRun?:number}} [opts]
 * @returns {{hits:Array, stats:{total,hits,elapsedSec}}}
 */
async function scanRedRecovery(pool, dateStr, opts = {}) {
    const uptoHHMM = opts.uptoHHMM || REC.endHHMM;
    logger.info(`[recovery] 扫描池 ${pool.length} 只  截止 ${uptoHHMM}  模式 ${opts.mode || 'backtest'}`);

    const t0 = Date.now();
    const results = await runBatch(pool, async (entry) => {
        const item = entry.item || entry; // 兼容 {item,...} 或裸 item
        const r = await evaluateRecovery(item, dateStr, opts);
        return {
            item,
            morningGainPct: entry.gainPct != null ? entry.gainPct : null,
            ...r,
        };
    }, config.concurrency.batchSize);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const hits = results.filter(r => r.hit);
    logger.info(`[recovery] 完成 elapsed=${elapsed}s  hits=${hits.length}/${pool.length}`);
    return { hits, stats: { total: pool.length, hits: hits.length, elapsedSec: parseFloat(elapsed) } };
}

module.exports = { detectRGR, evaluateRecovery, scanRedRecovery };
