'use strict';

/**
 * 全局配置：数据源端点、并发、HTTP 头、缓存等。
 */
const path = require('path');

const config = {
    dataSource: {
        sinaList: 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData',
        tencentKline: 'https://ifzq.gtimg.cn/appstock/app/kline/mkline',
        eastmoneyKline: 'https://push2his.eastmoney.com/api/qt/stock/kline/get',
        sinaKline: 'https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_kl_=/CN_MarketDataService.getKLineData',
    },
    concurrency: {
        batchSize: parseInt(process.env.BATCH_SIZE || '30', 10),
        requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '10000', 10),
        retryMax: parseInt(process.env.RETRY_MAX || '1', 10),
    },
    cache: {
        dir: path.resolve(__dirname, '..', '..', 'data', 'cache'),
        ttlMs: parseInt(process.env.CACHE_TTL_MS || '86400000', 10), // 24h
    },
    // 日志：带时间戳的运行日志文件，写到 data/logs/scan-<ts>.log
    log: {
        dir: path.resolve(__dirname, '..', '..', 'data', 'logs'),
        level: process.env.LOG_LEVEL || 'info', // debug|info|warn|error；debug 会刷控制台，建议用 info
    },
    httpHeaders: {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Referer: 'https://finance.sina.com.cn/',
    },
    // 开发态：限制扫描前 N 只（0=不限）
    devLimitSymbols: parseInt(process.env.DEV_LIMIT_SYMBOLS || '0', 10),
    // 命中后过滤：涨幅（窗口末根收盘 vs 前日尾盘）低于此值剔除；直接涨停（盘中触及涨停价）剔除
    filter: {
        minGainPct: parseFloat(process.env.MIN_GAIN_PCT || '3'),
        excludeLimitUp: process.env.EXCLUDE_LIMIT_UP !== '0',
    },
    // 早盘窗口（含起止）。从 09:31 起：09:30 是当日 EMA 种子根（HIST 恒为 0），
    // 跳过它以对齐 app 的"开盘后 15 分钟 MACD 全红"。
    window: {
        startHHMM: '0931',
        endHHMM: '0945',
    },
    // 红柱恢复（R-G-R）：09:45 后在早盘全红池里继续监控"红-绿-红"恢复结构。
    //   Phase1 早盘红 = 0931~0945 全红（池成员隐式成立），取其 ΣHIST 作为红面积；
    //   Phase2 抛压绿 = 0945 后第一段连续绿柱，长度≥minGreenRun；
    //   Phase3 恢复红 = Phase2 后连续红柱，长度≥minRedRun；
    //   命中 = Phase2、Phase3 均达标 且 红面积/绿面积 ≥ minAreaRatio。
    recovery: {
        startHHMM: '0946',      // 恢复扫描窗口起
        endHHMM: '1030',        // 恢复扫描窗口止（也是最终快照时刻）
        minGreenRun: 2,         // Phase2 最少连续绿柱根数
        minRedRun: 2,           // Phase3 最少连续红柱根数
        minAreaRatio: 2,        // 红面积/绿面积 最小比值，低于此值视为做多力度不足而过滤
        scanIntervalSec: parseInt(process.env.RECOVERY_SCAN_INTERVAL_SEC || '120', 10), // 2 分钟
    },

    // 飞书自定义机器人 webhook 推送（live 模式逐轮增量 + 最终快照）。
    //   未配置 webhook URL → 静默不推送，扫描行为与改动前一致。
    notify: {
        feishuWebhookUrl: process.env.FEISHU_WEBHOOK_URL || '', // 飞书自定义机器人 webhook，留空=不推送
        feishuSecret: process.env.FEISHU_SECRET || '',          // 启用签名校验时的 secret，留空=不签名
        feishuTimeoutMs: parseInt(process.env.FEISHU_TIMEOUT_MS || '5000', 10),
    },
};

module.exports = config;
