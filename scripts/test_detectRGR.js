'use strict';
// 纯函数 detectRGR 离线自检（无网络），覆盖五个分支。
const { detectRGR } = require('../src/scanner/redRecovery');
const assert = require('assert');

const PHASE1_LEN = 15; // 0931~0945 共 15 根
const red = (n, v = 0.5) => new Array(n).fill(v);   // 红柱（HIST>0）
const green = (n, v = -0.3) => new Array(n).fill(v); // 绿柱（HIST<0）

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
    if (cond) { console.log(`  OK   ${name} ${extra}`); pass++; }
    else { console.error(`  FAIL ${name} ${extra}`); fail++; }
}

// 1) 经典命中：早红15 + 绿2 + 红3，红面积>绿面积
{
    const w = red(15, 0.5).concat(green(2, -0.25), red(3, 0.4));
    const r = detectRGR(w, { phase1Len: PHASE1_LEN, minGreenRun: 2, minRedRun: 2 });
    check('1 经典命中', r.hit === true && r.greenRunLen === 2 && r.redRunLen === 3,
        `hit=${r.hit} 绿${r.greenRunLen} 红${r.redRunLen} 红${r.redArea1} 绿${r.greenArea} 比${r.areaRatio && r.areaRatio.toFixed(2)} confirmIdx=${r.confirmIdx}`);
    check('1 确认下标=18(第2根恢复红)', r.confirmIdx === 18, `confirmIdx=${r.confirmIdx}`);
}

// 2) 面积不足：早红面积 < 绿面积 → 不命中
{
    const w = red(15, 0.1).concat(green(2, -0.85), red(2, 0.2)); // 红1.5 < 绿1.7
    const r = detectRGR(w, { phase1Len: PHASE1_LEN, minGreenRun: 2, minRedRun: 2 });
    check('2 面积不足不命中', r.hit === false, `hit=${r.hit} 红${r.redArea1} 绿${r.greenArea} 比${r.areaRatio && r.areaRatio.toFixed(2)}`);
    check('2 confirmIdx!=-1(已确认结构,仅面积不够)', r.confirmIdx !== -1, `confirmIdx=${r.confirmIdx}`);
}

// 3) 无 Phase2：绿柱不足2根 → 不命中
{
    const w = red(15, 0.5).concat(green(1, -0.2), red(3, 0.4)); // 单根绿被跳过
    const r = detectRGR(w, { phase1Len: PHASE1_LEN, minGreenRun: 2, minRedRun: 2 });
    check('3 无Phase2不命中', r.hit === false && r.greenRunLen === 0, `hit=${r.hit} greenRunLen=${r.greenRunLen}`);
}

// 4) 无 Phase3：有绿段但后续红柱不足2根 → 不命中
{
    const w = red(15, 0.5).concat(green(2, -0.25), red(1, 0.4)); // 恢复红仅1根
    const r = detectRGR(w, { phase1Len: PHASE1_LEN, minGreenRun: 2, minRedRun: 2 });
    check('4 无Phase3不命中', r.hit === false && r.greenRunLen === 2 && r.redRunLen === 0,
        `hit=${r.hit} 绿${r.greenRunLen} 红${r.redRunLen}`);
}

// 5) 短绿被跳过，后续真正绿+红命中
{
    // rest: [-0.1(短绿1), +0.2, -0.3,-0.4(真绿2), +0.5,+0.5(真红2)]
    const w = red(15, 0.5).concat([-0.1, 0.2], green(2, -0.35), red(2, 0.5));
    const r = detectRGR(w, { phase1Len: PHASE1_LEN, minGreenRun: 2, minRedRun: 2 });
    check('5 短绿跳过后命中', r.hit === true && r.greenRunLen === 2, `hit=${r.hit} 绿${r.greenRunLen} 红${r.redRunLen} 红${r.redArea1} 绿${r.greenArea}`);
    // p2Start 在 rest 中应为 2（跳过 idx0 短绿、idx1 红后），confirmIdx=15+4+2-1=20
    check('5 确认下标=20', r.confirmIdx === 20, `confirmIdx=${r.confirmIdx}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
