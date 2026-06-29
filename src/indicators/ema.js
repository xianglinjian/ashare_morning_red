'use strict';

/**
 * 指数加权均线 EMA：
 *   EMA(N)_t = k * P_t + (1-k) * EMA(N)_{t-1}     k = 2/(N+1)
 *   EMA_0 = P_0
 */
function ema(prices, period) {
    if (!Array.isArray(prices) || prices.length === 0) return [];
    if (!(period > 0)) throw new Error('ema: period must be > 0');
    const k = 2 / (period + 1);
    const out = new Array(prices.length);
    out[0] = prices[0];
    for (let i = 1; i < prices.length; i++) {
        const p = prices[i];
        if (!Number.isFinite(p)) {
            out[i] = out[i - 1];
            continue;
        }
        out[i] = k * p + (1 - k) * out[i - 1];
    }
    return out;
}

module.exports = { ema };
