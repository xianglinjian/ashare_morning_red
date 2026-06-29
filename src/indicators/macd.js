'use strict';

/**
 * 通达信/同花顺标准 MACD(12, 26, 9):
 *   DIF  = EMA(close, 12) - EMA(close, 26)
 *   DEA  = EMA(DIF, 9)
 *   HIST = (DIF - DEA) * 2
 * HIST > 0 → 红柱  HIST < 0 → 绿柱
 */
const { ema } = require('./ema');

function macd(prices, short = 12, long = 26, mid = 9) {
    if (!Array.isArray(prices) || prices.length === 0) {
        return { dif: [], dea: [], hist: [] };
    }
    const emaShort = ema(prices, short);
    const emaLong = ema(prices, long);
    const dif = new Array(prices.length);
    for (let i = 0; i < prices.length; i++) {
        dif[i] = emaShort[i] - emaLong[i];
    }
    const dea = ema(dif, mid);
    const hist = new Array(prices.length);
    for (let i = 0; i < prices.length; i++) {
        hist[i] = (dif[i] - dea[i]) * 2;
    }
    return { dif, dea, hist };
}

module.exports = { macd };
