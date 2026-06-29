'use strict';

const { parseCliArgs, normalizeDate } = require('./utils/dateUtil');
const { scanMorningRed } = require('./scanner/morningRed');
const { scanRedRecovery } = require('./scanner/redRecovery');
const config = require('./config');
const { getSectorInfo } = require('./utils/sectorMap');
const logger = require('./utils/logger');
const { notifyFeishu } = require('./utils/notifyFeishu');

// CJK 显示宽度：中文及全角字符算 2 列
function dispW(s) {
    let n = 0;
    for (const ch of String(s)) {
        n += (ch.charCodeAt(0) > 0x2E80) ? 2 : 1;
    }
    return n;
}
function padR(s, w) {
    s = String(s);
    const p = w - dispW(s);
    return p > 0 ? s + ' '.repeat(p) : s;
}
function padL(s, w) {
    s = String(s);
    const p = w - dispW(s);
    return p > 0 ? ' '.repeat(p) + s : s;
}

function fmt(n) {
    return Number.isFinite(n) ? n.toFixed(4) : String(n);
}

// 交易板细分：按代码前两位映射到上证主板/科创板/深主板/创业板/北交所/沪B/深B
function boardOf(code) {
    if (!code || code.length < 6) return '其他';
    const p2 = code.slice(0, 2);
    if (p2 === '60') return '上证主板';
    if (p2 === '68') return '科创板';
    if (p2 === '90') return '沪B';
    if (p2 === '00') return '深主板';
    if (p2 === '30') return '创业板';
    if (p2 === '20') return '深B';
    if (p2 === '43' || p2 === '83' || p2 === '87' || p2 === '88' || p2 === '92') return '北交所';
    return '其他';
}

const COLS = [
    { key: '代码',    w: 8,  align: 'L' },
    { key: '名称',    w: 14, align: 'L' },
    { key: '板块',    w: 18, align: 'L' },
    { key: '市场',    w: 4,  align: 'L' },
    { key: 'bars',    w: 5,  align: 'R' },
    { key: '首根ts',  w: 14, align: 'R' },
    { key: '末根ts',  w: 14, align: 'R' },
    { key: 'minHist', w: 9,  align: 'R' },
    { key: 'maxHist', w: 9,  align: 'R' },
    { key: '涨幅%',   w: 8,  align: 'R' },
];

function row(values) {
    return values
        .map((v, i) => (COLS[i].align === 'R' ? padL(v, COLS[i].w) : padR(v, COLS[i].w)))
        .join(' ');
}

function rowOf(r) {
    const it = r.item;
    return row([
        it.code,
        it.name,
        r.sectorDisplay,
        it.market,
        r.bars,
        r.firstTs,
        r.lastTs,
        fmt(r.minHist),
        fmt(r.maxHist),
        r.gainPct == null ? '-' : r.gainPct.toFixed(2),
    ]);
}

// 按交易板 → 主板块 → minHist 分层排序输出
function printGrouped(hits, dateStr) {
    if (!hits.length) {
        console.log('\n本次扫描没有命中：09:30~09:45 全红柱的股票为 0。');
        return;
    }
    console.log(`\n=== 命中 ${hits.length} 只（${dateStr} 09:30~09:45 MACD HIST 全为红柱）===`);

    // 1) 分组到交易板
    const byBoard = new Map();
    for (const r of hits) {
        const b = r.board;
        if (!byBoard.has(b)) byBoard.set(b, []);
        byBoard.get(b).push(r);
    }

    // 2) 交易板排序：固定优先级 + 命中数 desc 作为次序兜底
    const BOARD_ORDER = ['上证主板', '科创板', '深主板', '创业板', '北交所', '沪B', '深B', '其他'];
    const boards = Array.from(byBoard.keys()).sort((a, b) => {
        const ia = BOARD_ORDER.indexOf(a);
        const ib = BOARD_ORDER.indexOf(b);
        const ra = ia === -1 ? 999 : ia;
        const rb = ib === -1 ? 999 : ib;
        if (ra !== rb) return ra - rb;
        return byBoard.get(b).length - byBoard.get(a).length;
    });

    // 表头只打一次
    console.log(row(COLS.map(c => c.key)));

    for (const board of boards) {
        const arr = byBoard.get(board);
        // 板内：按主板块出现次数 desc → 主板块名 → minHist desc
        const cnt = new Map();
        for (const r of arr) cnt.set(r.sectorPrimary, (cnt.get(r.sectorPrimary) || 0) + 1);
        arr.sort((a, b) => {
            const dc = cnt.get(b.sectorPrimary) - cnt.get(a.sectorPrimary);
            if (dc) return dc;
            const ds = a.sectorPrimary.localeCompare(b.sectorPrimary, 'zh-Hans-CN');
            if (ds) return ds;
            return b.minHist - a.minHist;
        });

        console.log(`\n--- ${board}（${arr.length}）---`);
        for (const r of arr) console.log(rowOf(r));
    }
}

function printSectorSummary(hits) {
    if (!hits.length) return;
    const cnt = new Map();
    for (const r of hits) cnt.set(r.sectorPrimary, (cnt.get(r.sectorPrimary) || 0) + 1);
    const list = Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]);
    console.log('\n板块分布（按主标签）:');
    for (const [sec, n] of list) {
        console.log(`  ${padR(sec, 12)} ${padL(n, 4)}`);
    }
}

function printBoardSummary(hits) {
    if (!hits.length) return;
    const cnt = new Map();
    for (const r of hits) cnt.set(r.board, (cnt.get(r.board) || 0) + 1);
    const BOARD_ORDER = ['上证主板', '科创板', '深主板', '创业板', '北交所', '沪B', '深B', '其他'];
    const list = Array.from(cnt.entries()).sort((a, b) => {
        const ia = BOARD_ORDER.indexOf(a[0]);
        const ib = BOARD_ORDER.indexOf(b[0]);
        const ra = ia === -1 ? 999 : ia;
        const rb = ib === -1 ? 999 : ib;
        if (ra !== rb) return ra - rb;
        return b[1] - a[1];
    });
    console.log('\n交易板分布:');
    for (const [b, n] of list) {
        console.log(`  ${padR(b, 10)} ${padL(n, 4)}`);
    }
}

async function main() {
    const args = parseCliArgs(process.argv);
    const dateStr = normalizeDate(args.date);
    console.log(`[main] 目标交易日: ${dateStr}  模式: ${args.mode}`);

    const { hits, stats } = await scanMorningRed(dateStr, { limit: args.limit });

    // 注入板块与交易板标签
    hits.forEach(r => {
        const s = getSectorInfo(r.item.code);
        r.sectorPrimary = s.primary;
        r.sectorDisplay = s.display;
        r.board = boardOf(r.item.code);
    });

    printGrouped(hits, dateStr);
    printBoardSummary(hits);
    printSectorSummary(hits);
    console.log('\n统计:', JSON.stringify(stats));
    if (logger.logFile()) console.log(`日志文件: ${logger.logFile()}`);

    // —— 红柱恢复（R-G-R）扫描 ——
    let pool = hits;
    if (args.poolLimit > 0) {
        pool = pool.slice(0, args.poolLimit);
        console.log(`\n[recovery] --pool-limit=${args.poolLimit} 池子截断为 ${pool.length} 只`);
    }

    const effectiveMode = resolveMode(args, dateStr);
    if (effectiveMode === 'live') {
        await runLive(pool, dateStr, args);
    } else {
        await runBacktest(pool, dateStr);
    }
}

/** 模式解析：auto 按当前北京时间/是否带 date 决定；live/backtest 直通。 */
function resolveMode(args, dateStr) {
    if (args.mode === 'live') return 'live';
    if (args.mode === 'backtest') return 'backtest';
    // auto
    if (args.date) return 'backtest'; // 指定了历史日 → 回测
    const now = new Date();
    const hhmm = now.toTimeString().slice(0, 5).replace(':', ''); // 本机时间近似
    if (hhmm >= config.recovery.startHHMM && hhmm < config.recovery.endHHMM) return 'live';
    return 'backtest';
}

/** 一次性回测：0931→1030 全程算完出快照。 */
async function runBacktest(pool, dateStr) {
    if (!pool.length) {
        console.log('\n[recovery] 早盘池为空，跳过红柱恢复扫描。');
        return;
    }
    const uptoHHMM = config.recovery.endHHMM;
    console.log(`\n=== 红柱恢复(R-G-R)回测  ${dateStr}  截止 ${uptoHHMM} ===`);
    console.log(`候选池: ${pool.length} 只`);
    const { hits: rh, stats: rstats } = await scanRedRecovery(pool, dateStr, { mode: 'backtest', uptoHHMM });
    annotateRecoveryHits(rh);
    printRecoveryGrouped(rh, dateStr, uptoHHMM, { live: false }); // 收盘后→列最终收盘涨幅
    printRecoverySummary(rh, pool.length);
    console.log('\n恢复扫描统计:', JSON.stringify(rstats));
}

/**
 * 实时循环。
 * - 带历史日（--date）→ 模拟回放：用 mock 时钟 0946→1030 每 2 分钟扫一次，
 *   截止时刻随 mock 时间推进，新确认的股票逐条 emitAlert。不真实 sleep，
 *   用于在历史日上验证「逐轮扫描 → 逐条推送」的流程（下一步接飞书/微信）。
 * - 不带日期 → 真实时墙钟轮询：每 scanIntervalSec 扫到当前时刻。
 */
async function runLive(pool, dateStr, args) {
    if (!pool.length) {
        console.log('\n[recovery] 早盘池为空，跳过红柱恢复扫描。');
        return;
    }
    const { startHHMM, endHHMM, scanIntervalSec } = config.recovery;
    const isReplay = !!(args && args.date); // 指定了历史日 → 模拟回放
    const modeLabel = isReplay ? '模拟回放' : '实时监控';

    console.log(`\n=== 红柱恢复(R-G-R)${modeLabel}  ${dateStr}  ${startHHMM}~${endHHMM}  间隔${scanIntervalSec}s ===`);
    console.log(`候选池: ${pool.length} 只`);

    // mock 扫描时刻表：startHHMM → endHHMM，每 scanIntervalSec/60 分钟一跳
    const scanTimes = buildMockScanTimes(startHHMM, endHHMM, scanIntervalSec);
    console.log(`扫描轮次: ${scanTimes.length} 轮  ${scanTimes[0]}→${scanTimes[scanTimes.length - 1]}`);

    const confirmed = new Map(); // code -> hit（已确认，不再重扫）
    const pending = pool.slice(); // 尚未确认的成员

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    /**
     * 单轮扫描：截止 uptoHHMM，对新确认的命中逐条 emitAlert。
     * uptoHHMM 越早，detectRGR 的 histWindow 越短，未达阈值的股票不会被确认。
     */
    const scanOnce = async (uptoHHMM, roundNo) => {
        if (!pending.length) return;
        const t0 = Date.now();
        const { hits: rh } = await scanRedRecovery(pending, dateStr, { mode: 'live', uptoHHMM });
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        let newCount = 0;
        for (const r of rh) {
            if (confirmed.has(r.item.code)) continue; // 已确认，跳过
            annotateRecoveryHits([r]);
            confirmed.set(r.item.code, r);
            await emitAlert(r, uptoHHMM);
            newCount++;
        }
        // 从 pending 移除已确认
        for (let i = pending.length - 1; i >= 0; i--) {
            if (confirmed.has(pending[i].item.code)) pending.splice(i, 1);
        }
        console.log(`[${uptoHHMM}] 第${roundNo}轮完成 耗时${elapsed}s 新增${newCount} 累计${confirmed.size}/${pool.length} 待确认${pending.length}`);
    };

    if (isReplay) {
        // —— 模拟回放：顺次推进 mock 时钟，无真实 sleep（瞬间完成）——
        for (let i = 0; i < scanTimes.length; i++) {
            await scanOnce(scanTimes[i], i + 1);
            if (!pending.length) {
                console.log(`[${scanTimes[i]}] 池内全部确认完毕，提前结束。`);
                break;
            }
        }
    } else {
        // —— 真实时墙钟轮询：扫到当前时刻，每 scanIntervalSec 一轮 ——
        const sleepMs = scanIntervalSec * 1000;
        for (;;) {
            const hhmm = new Date().toTimeString().slice(0, 5).replace(':', '');
            if (hhmm >= endHHMM) break;
            await scanOnce(hhmm, 1);
            if (!pending.length) {
                console.log(`[${nowHHMMSS()}] 池内全部确认完毕，提前结束。`);
                break;
            }
            console.log(`[${nowHHMMSS()}] 已确认 ${confirmed.size}/${pool.length}，等待下一轮...`);
            await sleep(sleepMs);
        }
        await scanOnce(endHHMM, 1); // 收盘兜底
    }

    const all = Array.from(confirmed.values());
    console.log(`\n=== ${endHHMM} 最终快照 ===`);
    // 回放=收盘后→列收涨(finalGainPct)；真实时=盘中→列时涨(currentGainPct)
    const groupedText = printRecoveryGrouped(all, dateStr, endHHMM, { live: !isReplay });
    const summaryText = printRecoverySummary(all, pool.length);
    // 推送最终快照（分组表 + 汇总）到飞书群；未配置 webhook 则静默跳过
    await notifyFeishu(`${groupedText}\n${summaryText}`);
}

/**
 * 生成 mock 扫描时刻表（HHMM 字符串数组）。
 * 例：0946→1030 步长2 → ['0946','0948',...,'1030']
 */
function buildMockScanTimes(startHHMM, endHHMM, scanIntervalSec) {
    const stepMin = Math.max(1, Math.round(scanIntervalSec / 60));
    const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
    const toHHMM = (m) => {
        const h = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        return `${h}${mm}`;
    };
    const out = [];
    for (let m = toMin(startHHMM); m <= toMin(endHHMM); m += stepMin) out.push(toHHMM(m));
    return out;
}

/**
 * 命中推送：当前仅打印到控制台，是飞书/微信群通知的接入点。
 * 后续在此函数内追加 webhook 调用即可，扫描逻辑无需改动。
 * @param {object} hit scanRedRecovery 返回的命中（含 item/code/name/confirmHHMM/areaRatio/...）
 * @param {string} scanHHMM 本轮扫描截止时刻（HHMM）
 */
async function emitAlert(hit, scanHHMM) {
    const ratio = (hit.areaRatio || 0).toFixed(2);
    const gain = hit.currentGainPct == null ? '-' : hit.currentGainPct.toFixed(2);
    const sector = hit.sectorDisplay || '未分类';
    const line =
        `[${scanHHMM}] +${hit.item.code} ${hit.item.name} [${sector}] 确认恢复`
        + `（绿${hit.greenRunLen}红${hit.redRunLen} 比${ratio} ${hit.confirmHHMM}确认 时涨${gain}%）`;
    console.log(line);
    await notifyFeishu(line); // 推送增量命中到飞书群（未配置 webhook 则静默跳过；永不抛出）
}

function nowHHMMSS() {
    return new Date().toTimeString().slice(0, 8);
}

/** 给恢复命中补齐 sector/board 标签（复用早盘扫描口径）。 */
function annotateRecoveryHits(hits) {
    for (const r of hits) {
        const s = getSectorInfo(r.item.code);
        r.sectorPrimary = s.primary;
        r.sectorDisplay = s.display;
        r.board = boardOf(r.item.code);
    }
}

function printRecoveryGrouped(hits, dateStr, uptoHHMM, opts = {}) {
    const lines = []; // 同时收集文本，供飞书推送（既 console.log 又返回完整文本）
    const push = (s) => { console.log(s); lines.push(s); };

    if (!hits.length) {
        push(`\n本次红柱恢复没有命中（${dateStr} 截止 ${uptoHHMM}）。`);
        return lines.join('\n');
    }
    const live = opts.live; // true=盘中实时，收盘涨幅未必可得；否则为收盘后，可追加收涨
    push(`\n=== 红柱恢复命中 ${hits.length} 只（${dateStr} 截止 ${uptoHHMM}）===`);

    const byBoard = new Map();
    for (const r of hits) {
        if (!byBoard.has(r.board)) byBoard.set(r.board, []);
        byBoard.get(r.board).push(r);
    }
    const BOARD_ORDER = ['上证主板', '科创板', '深主板', '创业板', '北交所', '沪B', '深B', '其他'];
    const boards = Array.from(byBoard.keys()).sort((a, b) => {
        const ra = BOARD_ORDER.indexOf(a); const rb = BOARD_ORDER.indexOf(b);
        return (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb);
    });

    for (const board of boards) {
        const arr = byBoard.get(board);
        const cnt = new Map();
        for (const r of arr) cnt.set(r.sectorPrimary, (cnt.get(r.sectorPrimary) || 0) + 1);
        arr.sort((a, b) => {
            const dc = cnt.get(b.sectorPrimary) - cnt.get(a.sectorPrimary);
            if (dc) return dc;
            const ds = a.sectorPrimary.localeCompare(b.sectorPrimary, 'zh-Hans-CN');
            if (ds) return ds;
            return (b.areaRatio || 0) - (a.areaRatio || 0);
        });
        push(`\n--- ${board}（${arr.length}）---`);
        for (const r of arr) {
            const curGain = r.currentGainPct == null ? '-' : r.currentGainPct.toFixed(2);
            let tail = `时涨${curGain}%`;
            // 收盘后场景（回测/回放）追加最终收盘涨幅，便于对比效果
            if (!live && r.finalGainPct != null) {
                tail += ` | 收涨${r.finalGainPct.toFixed(2)}%`;
            }
            const sector = r.sectorDisplay || '未分类';
            push(
                `  ${r.item.code} ${padR(r.item.name, 12)}  [${sector}]  早红15 | 绿${r.greenRunLen} 红${r.redRunLen} | `
                + `红面积${fmt(r.redArea1)} 绿面积${fmt(r.greenArea)} 比${(r.areaRatio || 0).toFixed(2)} | `
                + `${r.confirmHHMM}确认 | ${tail}`
            );
        }
    }
    return lines.join('\n');
}

/**
 * （保留）按场景选涨幅：盘中实时→currentGainPct（扫描时刻），收盘后→finalGainPct（当日收盘）。
 * 当前 printRecoveryGrouped 改为同时展示时涨+收涨，本函数暂留备用。
 * @returns {{label:string, gain:string}}
 */
function gainField(r, live) {
    if (live) {
        return { label: '时涨', gain: r.currentGainPct == null ? '-' : r.currentGainPct.toFixed(2) };
    }
    return { label: '收涨', gain: r.finalGainPct == null ? '-' : r.finalGainPct.toFixed(2) };
}

function printRecoverySummary(hits, poolSize) {
    let summary;
    if (!hits.length) {
        summary = `\n汇总: 命中 0/${poolSize}`;
    } else {
        const avgRatio = hits.reduce((s, r) => s + (r.areaRatio || 0), 0) / hits.length;
        const times = hits.map(r => r.confirmHHMM).filter(Boolean).sort();
        const earliest = times[0] || '-';
        const latest = times[times.length - 1] || '-';
        summary = `\n汇总: 命中 ${hits.length}/${poolSize} | 平均面积比 ${avgRatio.toFixed(2)} | 最早${earliest}确认 最晚${latest}`;
    }
    console.log(summary);
    return summary;
}

main().catch(err => {
    console.error('[fatal]', (err && err.stack) || err);
    logger.close();
    process.exit(1);
}).finally(() => {
    logger.close();
});
