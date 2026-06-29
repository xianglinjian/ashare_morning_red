'use strict';

/**
 * 从东方财富个股详情接口生成 sectors.json（code → 行业/地区）。
 * 东财个股详情返回 f127(行业) + f128(地区)，单票单行业。
 * 用法：node src/dataSource/sectorSeed.js
 * 输出：data/sectors.json，格式 { "603444": "游戏Ⅱ/福建板块" }
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config');
const { getSymbolList } = require('./symbolList');

const OUT_FILE = path.join(__dirname, '..', '..', 'data', 'sectors.json');

function toSecid(code) {
    if (!code || code.length < 6) return null;
    const p2 = code.slice(0, 2);
    if (p2 === '60' || p2 === '68' || p2 === '11' || p2 === '13' || p2 === '90') return `1.${code}`;
    return `0.${code}`;
}

async function fetchStockSector(code) {
    const secid = toSecid(code);
    if (!secid) return null;
    const url = `${config.dataSource.eastmoneyStockDetail || 'https://push2.eastmoney.com/api/qt/stock/get'}`;
    const params = {
        secid,
        fields: 'f127,f128',
        ut: 'fa5fd1943c7b386f172d6893dbfba10b',
    };
    const resp = await axios.get(url, {
        params,
        headers: config.httpHeaders,
        timeout: 8000,
        validateStatus: () => true,
    });
    if (resp.status !== 200) return null;
    const data = resp.data && resp.data.data;
    if (!data) return null;
    const industry = data.f127 || '';
    const region = data.f128 || '';
    if (!industry && !region) return null;
    // 主行业在前，地区在后；只取存在的部分
    const parts = [industry, region].filter(Boolean);
    return parts.join('/');
}

async function main() {
    console.log('[sectorSeed] 获取股票列表...');
    const symbols = await getSymbolList({ refresh: false });
    console.log(`[sectorSeed] 共 ${symbols.length} 只股票`);

    const map = {};
    let ok = 0, fail = 0;
    let batch = 0;
    const total = symbols.length;

    // 限制并发，避免触发东财限流
    const BATCH = 10;
    for (let i = 0; i < total; i += BATCH) {
        const chunk = symbols.slice(i, i + BATCH);
        const results = await Promise.all(chunk.map(async (item) => {
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const sec = await fetchStockSector(item.code);
                    if (sec) return { code: item.code, sec };
                    return { code: item.code, sec: null };
                } catch (e) {
                    if (attempt === 3) return { code: item.code, sec: null, err: e.message };
                    await new Promise(r => setTimeout(r, 300 * attempt));
                }
            }
            return { code: item.code, sec: null };
        }));
        for (const r of results) {
            if (r.sec) { map[r.code] = r.sec; ok++; }
            else fail++;
        }
        batch++;
        if (batch % 20 === 0 || i + BATCH >= total) {
            console.log(`[sectorSeed] 进度 ${Math.min(i + BATCH, total)}/${total}  ok=${ok} fail=${fail}`);
        }
        // 批次间小延迟，避免被限流
        await new Promise(r => setTimeout(r, 50));
    }

    const outDir = path.dirname(OUT_FILE);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(map, null, 2), 'utf-8');
    console.log(`[sectorSeed] 完成：成功 ${ok}/${total} -> ${OUT_FILE}`);
}

main().catch(e => {
    console.error('[sectorSeed] ERR', e.message);
    process.exit(1);
});
