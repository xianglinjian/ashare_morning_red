/**
 * 飞书自定义机器人 webhook 推送。
 *
 * 用法：
 *   const { notifyFeishu } = require('./utils/notifyFeishu');
 *   await notifyFeishu('一行文本或多行文本');
 *
 * 行为：
 * - 未配置 webhook URL（config.notify.feishuWebhookUrl 为空）→ 立即返回，保持「不推送」的原行为。
 * - 配置了 secret → 按飞书官方加签算法附 timestamp + sign。
 * - 全程 try/catch：网络/HTTP 错误只记 logger.warn，绝不抛出，
 *   以免影响扫描循环（扫描逻辑不应被通知失败拖垮）。
 *
 * @param {string} text 要推送的纯文本
 */
const crypto = require('crypto');
const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

async function notifyFeishu(text) {
    const webhookUrl = config.notify && config.notify.feishuWebhookUrl;
    if (!webhookUrl) return; // 未配置 → 静默跳过，保持原行为

    const secret = (config.notify && config.notify.feishuSecret) || '';
    const timeoutMs = (config.notify && config.notify.feishuTimeoutMs) || 5000;

    const body = { msg_type: 'text', content: { text } };
    if (secret) {
        // 飞书加签：stringToSign = "{timestamp}\n{secret}"，HMAC-SHA256 key=stringToSign, msg=''，base64
        const timestamp = Math.floor(Date.now() / 1000);
        const stringToSign = `${timestamp}\n${secret}`;
        const sign = crypto
            .createHmac('sha256', stringToSign)
            .update('')
            .digest('base64');
        body.timestamp = String(timestamp);
        body.sign = sign;
    }

    try {
        const resp = await axios.post(webhookUrl, body, { timeout: timeoutMs });
        // 飞书成功响应体里 code 不为 0 也算业务失败（如签名错/限流），记录便于排查
        const code = resp && resp.data && resp.data.code;
        if (code != null && code !== 0 && code !== '0') {
            logger.warn(`[feishu] 业务失败 code=${code} msg=${resp.data.msg || ''}`);
        } else {
            logger.info(`[feishu] 已推送 ${text.length} 字`);
        }
    } catch (err) {
        logger.warn(`[feishu] 推送失败: ${err && err.message ? err.message : err}`);
    }
}

module.exports = { notifyFeishu };
