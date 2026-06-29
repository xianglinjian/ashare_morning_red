'use strict';

/**
 * 交易所代码前缀映射（按前两位精确判定）：
 *   sh: 60 主板 / 68 科创板 / 90 沪B / 11 / 13
 *   sz: 00 主板 / 30 创业板 / 20 深B / 12
 *   bj: 43 / 83 / 87 / 88 / 92
 */
function prefixOf(code) {
    if (!code || code.length < 6) return null;
    const p2 = code.slice(0, 2);
    if (p2 === '60' || p2 === '68' || p2 === '90' || p2 === '11' || p2 === '13') return 'sh';
    if (p2 === '00' || p2 === '30' || p2 === '20' || p2 === '12') return 'sz';
    if (p2 === '43' || p2 === '83' || p2 === '87' || p2 === '88' || p2 === '92') return 'bj';
    return null;
}

function withPrefix(code) {
    const p = prefixOf(code);
    return p ? `${p}${code}` : code;
}

function stripPrefix(prefixed) {
    if (!prefixed) return '';
    return String(prefixed).replace(/^(sh|sz|bj)/i, '');
}

module.exports = { prefixOf, withPrefix, stripPrefix };
