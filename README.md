# mcad1 — 早盘 MACD 全红柱筛选器

筛选目标交易日 **09:30~09:45**（含起止 16 根 1m K 线）每根 MACD HIST 都 > 0（"红柱"）的 A 股。

## 安装

```bash
npm install
```

## 使用

```bash
# 扫描今天
npm run scan

# 指定交易日
node src/index.js --date=2026-06-23

# 调试：只扫描前 50 只
node src/index.js --date=2026-06-23 --limit=50
# 或
DEV_LIMIT_SYMBOLS=50 npm run scan
```

## 数据源

| 用途 | 端点 |
| --- | --- |
| A 股代码列表 | 新浪 `Market_Center.getHQNodeData`（GBK，分页 80/页） |
| 1m K 线（主） | 腾讯 `ifzq.gtimg.cn/.../mkline?param=<symbol>,m1,,320` |
| 1m K 线（备） | 东财 `push2his.eastmoney.com/api/qt/stock/kline/get`（bj 前缀首选；其它失败回落） |

腾讯返回 **open-side** 时间戳（"09:30" 表示 09:30→09:31），东财返回 **close-side**，已在 `eastmoneyKline.js` 中统一前移 1 分钟。

## 指标

通达信标准 MACD(12,26,9)：

```
DIF  = EMA(close,12) - EMA(close,26)
DEA  = EMA(DIF, 9)
HIST = (DIF - DEA) * 2     // 通达信柱体放大 2 倍
```

判定：窗口内每一根 HIST > 0 才算命中（严格"全红"）。

## 飞书推送

扫描结果可推送到飞书群自定义机器人 webhook。实现在 `src/utils/notifyFeishu.js`，配置在 `src/config/index.js`。

### 配置

全部通过环境变量配置，留空即不推送（扫描行为与无推送时一致）：

| 环境变量 | 说明 |
| --- | --- |
| `FEISHU_WEBHOOK_URL` | 飞书自定义机器人 webhook，形如 `https://open.feishu.cn/open-apis/bot/v2/hook/xxx`。留空=不推送 |
| `FEISHU_SECRET` | 机器人开启「签名校验」时的 secret，留空=不签名 |
| `FEISHU_TIMEOUT_MS` | 推送 HTTP 超时，默认 `5000` |

### 获取 webhook

1. 飞书群 → 设置 → 群机器人 → 添加「自定义机器人」
2. 复制 webhook URL 填入 `FEISHU_WEBHOOK_URL`
3. 若启用了「签名校验」，把生成的 secret 填入 `FEISHU_SECRET`；仅设「关键词」安全校验则留空

### 推送时机

- **逐轮增量命中**：`live` 模式每确认一只红柱恢复股票即推一条
- **最终快照**：扫描结束推送分组表 + 汇总

推送全程 try/catch：网络/HTTP 错误只记 `logger.warn`，绝不抛出，不会拖垮扫描循环。

### 运行

```bash
# 临时设置后运行
FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxx" \
FEISHU_SECRET="可选-仅签名校验时需要" \
npm run scan

# 回测历史日并推送（验证流程）
FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxx" \
node src/index.js --date=2026-06-23
```

> 代码只读环境变量，不读 `.env` 文件；如需可先 `export` 再运行。

## 过滤

- 名称含 `ST` / `*ST` / `退` 一律剔除
- 前两位代码无法映射到 `sh`/`sz`/`bj` 的剔除

## 缓存

- 股票列表本地缓存 24h：`data/cache/symbols.json`
- 通过 `node src/index.js --refresh` 暂不支持，强制刷新可删该文件
