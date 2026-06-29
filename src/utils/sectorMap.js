'use strict';

/**
 * 板块查表：code -> 短板块标签字符串。
 * 支持多标签格式 "主/副[/...]"，主标签用于分组排序，完整串用于显示。
 * 数据来源：data/sectors.json（静态种子）。未命中返回 "未分类"。
 */

const fs = require('fs');
const path = require('path');

let map = null;
function load() {
    if (map) return map;
    const fp = path.join(__dirname, '..', '..', 'data', 'sectors.json');
    try {
        const raw = fs.readFileSync(fp, 'utf8');
        const obj = JSON.parse(raw);
        // 过滤注释字段（以 _ 开头的 key 视为注释）
        map = {};
        for (const k of Object.keys(obj)) {
            if (k.startsWith('_')) continue;
            map[k] = obj[k];
        }
    } catch (e) {
        console.warn('[sectorMap] 载入 sectors.json 失败：', e.message);
        map = {};
    }
    return map;
}

function getSector(code) {
    const m = load();
    return m[String(code)] || '未分类';
}

function getSectorInfo(code) {
    const v = load()[String(code)] || '未分类';
    const primary = v.split('/')[0] || v;
    return { primary, display: v };
}

module.exports = { getSector, getSectorInfo };
