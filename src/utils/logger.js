'use strict';

/**
 * 统一日志：同时写控制台与时间戳文件（data/logs/scan-YYYYMMDD-HHMMSS.log）。
 *   - 控制台保持原样（不带时间戳），不破坏既有输出观感；
 *   - 文件每行带 "时间 [级别] 消息"，用于事后排查连接失败等。
 *   - debug 级仅写文件，避免控制台被每只股票刷屏。
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[config.log.level] || LEVELS.debug;

let stream = null;
let logFile = null;

function pad(n, w = 2) {
    return String(n).padStart(w, '0');
}

function nowParts() {
    const d = new Date();
    return {
        iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`,
        fileStamp: `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    };
}

function openStream() {
    if (stream) return stream;
    try {
        const dir = config.log.dir;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        logFile = path.join(dir, `scan-${nowParts().fileStamp}.log`);
        stream = fs.createWriteStream(logFile, { flags: 'a' });
        stream.write(`\n==== scan start ${nowParts().iso} pid=${process.pid} level=${config.log.level} ====\n`);
    } catch (e) {
        stream = null; // 文件不可用则只走控制台，绝不影响主流程
        console.warn(`[logger] 无法创建日志文件: ${e.message}`);
    }
    return stream;
}

function write(level, msg) {
    const lvl = LEVELS[level];
    // debug 级仅写文件，不进控制台（避免每只股票的 [fetch] 刷屏）
    if (level !== 'debug') {
        if (level === 'ERROR') console.error(msg);
        else if (level === 'WARN') console.warn(msg);
        else console.log(msg);
    }
    if (lvl < minLevel) return;
    const s = openStream();
    if (!s) return;
    try { s.write(`${nowParts().iso} [${level}] ${msg}\n`); } catch (_) {}
}

module.exports = {
    debug: (m) => write('debug', m),
    info: (m) => write('info', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
    logFile: () => logFile,
    close: () => {
        if (stream) {
            try { stream.end(); } catch (_) {}
            stream = null;
        }
    },
};
