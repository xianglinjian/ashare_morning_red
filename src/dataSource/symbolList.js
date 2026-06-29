'use strict';

/**
 * 拉取全市场 A 股代码列表（来源：新浪行情中心分页接口，GBK 编码 + 非严格 JSON）。
 * 本地缓存 24h，按 ST / 退 / 前缀不识别过滤。
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const iconv = require('iconv-lite');
const config = require('../config');
const { withPrefix, prefixOf } = require('../utils/codePrefix');

const CACHE_FILE = path.join(config.cache.dir, 'symbols.json');
const MIN_FULL_LIST_SIZE = parseInt(process.env.MIN_FULL_SYMBOLS || '4000', 10);
const REQUIRED_PREFIXES = ['60', '00', '30'];

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isFreshCache(filePath, ttlMs) {
    try {
        const st = fs.statSync(filePath);
        return (Date.now() - st.mtimeMs) < ttlMs;
    } catch (_) { return false; }
}

function readCache() {
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    } catch (_) { return null; }
}

function writeCache(list) {
    ensureDir(config.cache.dir);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(list), 'utf-8');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(page, num = 80, attempts = 3) {
    const url = `${config.dataSource.sinaList}?node=hs_a&num=${num}&page=${page}&sort=symbol&asc=1`;
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try {
            const resp = await axios.get(url, {
                responseType: 'arraybuffer',
                headers: config.httpHeaders,
                timeout: config.concurrency.requestTimeoutMs,
            });
            const text = iconv.decode(Buffer.from(resp.data), 'gbk');
            let data;
            try {
                data = JSON.parse(text);
            } catch (_) {
                // 新浪返回的 JSON 键无引号，修复后再解析
                const fixed = text.replace(/([{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
                data = JSON.parse(fixed);
            }
            return Array.isArray(data) ? data : [];
        } catch (e) {
            lastErr = e;
            if (i < attempts) await sleep(300 * i);
        }
    }
    throw lastErr;
}

function hasRequiredPrefixes(list) {
    return REQUIRED_PREFIXES.every(prefix => list.some(it => String(it.code || '').startsWith(prefix)));
}

function isCompleteList(list) {
    return Array.isArray(list) && list.length >= MIN_FULL_LIST_SIZE && hasRequiredPrefixes(list);
}

async function fetchAll() {
    const out = [];
    const num = 80;
    for (let page = 1; page <= 200; page++) {
        const t0 = Date.now();
        const list = await fetchPage(page, num);
        console.log(`[symbolList] page=${page} size=${list.length} elapsed=${Date.now() - t0}ms`);
        if (!list.length) break;
        for (const it of list) {
            const code = (it.code || '').toString();
            const name = (it.name || '').toString();
            const symbol = (it.symbol || withPrefix(code)).toString();
            if (!code || !name) continue;
            out.push({ code, name, symbol });
        }
        if (list.length < num) break;
    }
    if (!isCompleteList(out)) {
        throw new Error(`symbol list incomplete: count=${out.length}, hasRequiredPrefixes=${hasRequiredPrefixes(out)}`);
    }
    return out;
}

function isExcludedByName(name) {
    if (!name) return true;
    const u = name.toUpperCase();
    if (u.includes('ST')) return true;
    if (name.includes('退')) return true;
    return false;
}

function postFilter(list, includeST) {
    const out = [];
    for (const it of list) {
        if (!includeST && isExcludedByName(it.name)) continue;
        const market = prefixOf(it.code);
        if (!market) continue;
        out.push({
            code: it.code,
            name: it.name,
            symbol: it.symbol || withPrefix(it.code),
            market,
        });
    }
    if (config.devLimitSymbols > 0) return out.slice(0, config.devLimitSymbols);
    return out;
}

/**
 * 获取 A 股代码列表。
 * @param {{refresh?: boolean, includeST?: boolean}} [options]
 */
async function getSymbolList(options = {}) {
    const { refresh = false, includeST = false } = options;

    if (!refresh && isFreshCache(CACHE_FILE, config.cache.ttlMs)) {
        const cached = readCache();
        if (isCompleteList(cached)) {
            console.log(`[symbolList] 使用缓存（${cached.length}）`);
            return postFilter(cached, includeST);
        }
        if (cached && cached.length) {
            console.warn(`[symbolList] 缓存不完整（${cached.length}），重新拉取`);
        }
    }

    let list = [];
    try {
        list = await fetchAll();
    } catch (e) {
        const cached = readCache();
        if (cached && cached.length) return postFilter(cached, includeST);
        throw e;
    }

    if (!list.length) {
        const cached = readCache();
        if (isCompleteList(cached)) return postFilter(cached, includeST);
        throw new Error('symbol list fetch returned empty');
    }

    writeCache(list);
    return postFilter(list, includeST);
}

module.exports = { getSymbolList };
