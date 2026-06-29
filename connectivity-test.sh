#!/bin/bash
# A股数据通路连通性测试脚本
# 用法：bash connectivity-test.sh
# 判断标准：http_code=200 正常 | 000 + 短时间 = 被reset/封禁 | 超时 = 网络不通

CODE="603444"
echo "测试股票代码: $CODE"
echo "================================================"

echo ""
echo "=== 1. 新浪（股票列表 + 1m K线 + 行业节点）==="
echo "[股票列表]"
curl -sS -o /dev/null -w "  http_code=%{http_code} time=%{time_total}s\n" --max-time 10 \
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?node=hs_a&num=5&page=1&sort=symbol&asc=1"
echo "[1m K线]"
curl -sS -o /dev/null -w "  http_code=%{http_code} time=%{time_total}s\n" --max-time 10 \
  "https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_kl_=/CN_MarketDataService.getKLineData?symbol=sh${CODE}&scale=1&ma=no&datalen=5"
echo "[行业节点树]"
curl -sS -o /dev/null -w "  http_code=%{http_code} time=%{time_total}s\n" --max-time 10 \
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodes"

echo ""
echo "=== 2. 腾讯（1m K线，主数据源，与东方财富app一致）==="
curl -sS -o /dev/null -w "  http_code=%{http_code} time=%{time_total}s\n" --max-time 10 \
  "https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=sh${CODE},m1,,5"

echo ""
echo "=== 3. 东财（1m K线 + 行业分类，可能被重置）==="
echo "[1m K线]"
curl -sS -o /dev/null -w "  http_code=%{http_code} time=%{time_total}s\n" --max-time 10 \
  "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.${CODE}&ut=fa5fd1943c7b386f172d6893dbfba10b&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56&klt=1&fqt=1&end=20500101&lmt=5"
echo "[行业板块列表(496个)]"
curl -sS -o /dev/null -w "  http_code=%{http_code} time=%{time_total}s\n" --max-time 10 \
  "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&ut=fa5fd1943c7b386f172d6893dbfba10b&fs=m:90+t:2&fields=f12,f14"
echo "[板块成分股(BK0420)]"
curl -sS -o /dev/null -w "  http_code=%{http_code} time=%{time_total}s\n" --max-time 10 \
  "https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=5&po=1&np=1&ut=fa5fd1943c7b386f172d6893dbfba10b&fs=b:BK0420&fields=f12,f14"

echo ""
echo "================================================"
echo "判断标准：200=正常 | 000+短时间=被reset/封禁 | 超时(time≈10s)=网络不通"
echo "重点看 东财[行业板块列表] —— 若返回200，可用东财行业生成完整sectors.json"
