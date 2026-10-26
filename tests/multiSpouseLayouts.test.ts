import test from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/browser/entry";
import { BRANCHED_MARRIAGE_GAP, NODE_SIZE, PERSON_GAP } from "../src/layout/boxModel";
import { LayoutInput, LayoutResult } from "../src/model/layoutResult";

type Sex = "M" | "F" | "U";

// 模拟浏览器版 app.js 的 orderCouple：男左女右写入 partners
function couple(a: { id: string; sex: Sex }, b: { id: string; sex: Sex }): string[] {
  if (a.sex === "M" && b.sex !== "M") return [a.id, b.id];
  if (b.sex === "M" && a.sex !== "M") return [b.id, a.id];
  if (a.sex === "F" && b.sex !== "F") return [b.id, a.id];
  if (b.sex === "F" && a.sex !== "F") return [a.id, b.id];
  return [a.id, b.id];
}

function twoSpouses(centerSex: Sex, spouseSex: Sex, childrenPerUnion: number[]): LayoutInput {
  const center = { id: "P", sex: centerSex };
  const spouses = [{ id: "S1", sex: spouseSex }, { id: "S2", sex: spouseSex }];
  const persons: LayoutInput["persons"] = [
    { ...center, birthOrder: 1 },
    { ...spouses[0], birthOrder: 2 },
    { ...spouses[1], birthOrder: 3 }
  ];
  const childrenMap: LayoutInput["childrenMap"] = [];
  let order = 4;
  spouses.forEach((spouse, index) => {
    const ids: string[] = [];
    for (let i = 0; i < (childrenPerUnion[index] ?? 0); i++) {
      const id = `C${index + 1}_${i + 1}`;
      persons.push({ id, sex: i % 2 === 0 ? "M" : "F", birthOrder: order++ });
      ids.push(id);
    }
    childrenMap.push([`u${index + 1}`, ids]);
  });
  return {
    persons,
    unions: [
      { id: "u1", partners: couple(center, spouses[0]) },
      { id: "u2", partners: couple(center, spouses[1]) }
    ],
    childrenMap
  };
}

function okLayout(input: LayoutInput): LayoutResult {
  const response = layout(input);
  assert.ok(response.ok, response.ok ? "" : response.error.message);
  return response.layout;
}

function byId(result: LayoutResult) {
  return new Map(result.nodes.map((node) => [node.id, node]));
}

function assertSharedPersonBetweenSpouses(result: LayoutResult) {
  const nodes = byId(result);
  const p = nodes.get("P")!;
  const s1 = nodes.get("S1")!;
  const s2 = nodes.get("S2")!;
  assert.equal(p.y, s1.y);
  assert.equal(p.y, s2.y);
  const [leftSpouse, rightSpouse] = s1.x <= s2.x ? [s1, s2] : [s2, s1];
  assert.ok(leftSpouse.x < p.x && p.x < rightSpouse.x, "共享的人应位于两位配偶之间");
  for (const segment of result.relationshipSegments.filter((candidate) => candidate.type === "marriage")) {
    assert.equal(segment.points.length, 2, "两段婚配线都应是直连，而不是下沉绕行");
  }
}

function assertChildrenUnderOwnUnion(result: LayoutResult, input: LayoutInput) {
  const nodes = byId(result);
  for (const [unionId, childIds] of input.childrenMap) {
    if (childIds.length === 0) continue;
    const union = input.unions.find((candidate) => candidate.id === unionId)!;
    const partners = union.partners.map((id) => nodes.get(id)!);
    const center = (partners[0].x + partners[1].x) / 2;
    const childCenter = childIds.reduce((sum, id) => sum + nodes.get(id)!.x, 0) / childIds.length;
    assert.ok(Math.abs(center - childCenter) < 0.5, `${unionId} 的子女应居中于该段婚姻下方`);
    for (const id of childIds) assert.ok(nodes.get(id)!.y > partners[0].y);
  }
}

function positionsOf(result: LayoutResult) {
  return result.nodes
    .map((node) => `${node.id}:${node.x.toFixed(2)},${node.y.toFixed(2)}`)
    .sort()
    .join("|");
}

test("一男两女：无子女时本人居中，配偶分列两侧", () => {
  const input = twoSpouses("M", "F", [0, 0]);
  assertSharedPersonBetweenSpouses(okLayout(input));
});

test("一女两男：无子女时本人居中，配偶分列两侧", () => {
  const input = twoSpouses("F", "M", [0, 0]);
  assertSharedPersonBetweenSpouses(okLayout(input));
});

test("一女两男：各一子女时布局成功且子女挂在各自婚姻下", () => {
  const input = twoSpouses("F", "M", [1, 1]);
  const result = okLayout(input);
  assertSharedPersonBetweenSpouses(result);
  assertChildrenUnderOwnUnion(result, input);
});

test("一女两男与一男两女在各种子女数下结果对称", () => {
  for (const counts of [[2, 3], [0, 2], [2, 0], [1, 3], [3, 3]]) {
    const female = layout(twoSpouses("F", "M", counts));
    const male = layout(twoSpouses("M", "F", counts));
    assert.equal(female.ok, male.ok, `子女数 ${JSON.stringify(counts)} 男女结果应一致`);
    if (female.ok && male.ok) assert.equal(positionsOf(female.layout), positionsOf(male.layout));
  }
});

function assertNoSameGenerationOverlap(result: LayoutResult) {
  const nodes = [...result.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 1; i < nodes.length; i++) {
    const previous = nodes[i - 1];
    const current = nodes[i];
    if (previous.y !== current.y) continue;
    assert.ok(current.x - previous.x >= NODE_SIZE, `${previous.id} 与 ${current.id} 符号重叠`);
  }
}

test("枢纽：两段婚姻各多名子女时两组子女不重叠、各自居中（[2,3]、[3,3]）", () => {
  for (const counts of [[2, 3], [3, 3], [1, 3]]) {
    const input = twoSpouses("F", "M", counts);
    const result = okLayout(input);
    assertSharedPersonBetweenSpouses(result);
    assertChildrenUnderOwnUnion(result, input);
    assertNoSameGenerationOverlap(result);
  }
});

test("枢纽：只有一段婚姻有子女时无子女配偶仍紧邻本人（[0,2]、[2,0]）", () => {
  for (const counts of [[0, 2], [2, 0]]) {
    const input = twoSpouses("F", "M", counts);
    const result = okLayout(input);
    assertSharedPersonBetweenSpouses(result);
    assertChildrenUnderOwnUnion(result, input);
    const nodes = byId(result);
    const childless = counts[0] === 0 ? nodes.get("S1")! : nodes.get("S2")!;
    assert.ok(Math.abs(childless.x - nodes.get("P")!.x) <= BRANCHED_MARRIAGE_GAP + 0.5, "无子女配偶应紧邻本人");
  }
});

test("枢纽：婚姻先后决定左右——order 小的配偶在左，与 partners 顺序和创建顺序无关", () => {
  const base = twoSpouses("F", "M", [1, 1]);
  // u2 标记为更早的婚姻：S2 应排到左边
  const reordered: LayoutInput = {
    ...base,
    unions: [
      { ...base.unions[0], order: 2 },
      { ...base.unions[1], order: 1 }
    ]
  };
  const nodes = byId(okLayout(reordered));
  assert.ok(nodes.get("S2")!.x < nodes.get("P")!.x && nodes.get("P")!.x < nodes.get("S1")!.x);

  // 不带 order 时按 union id 顺序：S1 在左
  const plain = byId(okLayout(base));
  assert.ok(plain.get("S1")!.x < plain.get("P")!.x && plain.get("P")!.x < plain.get("S2")!.x);
});

test("枢纽：三段婚姻时配偶按先后排列，子女各归其位", () => {
  const input: LayoutInput = {
    persons: [
      { id: "P", sex: "M", birthOrder: 1 },
      { id: "S1", sex: "F", birthOrder: 2 },
      { id: "S2", sex: "F", birthOrder: 3 },
      { id: "S3", sex: "F", birthOrder: 4 },
      { id: "C1", sex: "U", birthOrder: 5 },
      { id: "C2", sex: "U", birthOrder: 6 },
      { id: "C3", sex: "U", birthOrder: 7 }
    ],
    unions: [
      { id: "u1", partners: ["P", "S1"], order: 1 },
      { id: "u2", partners: ["P", "S2"], order: 2 },
      { id: "u3", partners: ["P", "S3"], order: 3 }
    ],
    childrenMap: [["u1", ["C1"]], ["u2", ["C2"]], ["u3", ["C3"]]]
  };
  const result = okLayout(input);
  const nodes = byId(result);
  assert.ok(nodes.get("S1")!.x < nodes.get("P")!.x);
  assert.ok(nodes.get("P")!.x < nodes.get("S2")!.x && nodes.get("S2")!.x < nodes.get("S3")!.x);
  assertChildrenUnderOwnUnion(result, input);
  assertNoSameGenerationOverlap(result);
});

test("枢纽：配偶自带原生家庭时仍能布局，配偶与其父母保持连接", () => {
  const input: LayoutInput = {
    persons: [
      { id: "gf", sex: "M", birthOrder: 1 },
      { id: "gm", sex: "F", birthOrder: 2 },
      { id: "S1", sex: "M", birthOrder: 3 },
      { id: "P", sex: "F", birthOrder: 4 },
      { id: "S2", sex: "M", birthOrder: 5 },
      { id: "C1", sex: "U", birthOrder: 6 },
      { id: "C2", sex: "U", birthOrder: 7 }
    ],
    unions: [
      { id: "origin", partners: ["gf", "gm"] },
      { id: "u1", partners: ["S1", "P"], order: 1 },
      { id: "u2", partners: ["S2", "P"], order: 2 }
    ],
    childrenMap: [["origin", ["S1"]], ["u1", ["C1"]], ["u2", ["C2"]]]
  };
  const result = okLayout(input);
  const nodes = byId(result);
  assert.ok(nodes.get("S1")!.x < nodes.get("P")!.x && nodes.get("P")!.x < nodes.get("S2")!.x);
  assert.ok(nodes.get("S1")!.y > nodes.get("gf")!.y);
  assert.ok(Math.abs(nodes.get("S1")!.x - (nodes.get("gf")!.x + nodes.get("gm")!.x) / 2) < 0.5, "配偶应居中于其父母下方");
  assertChildrenUnderOwnUnion(result, input);
  assertNoSameGenerationOverlap(result);
});

test("先证者之母再婚并生育同母异父弟", () => {
  const input: LayoutInput = {
    persons: [
      { id: "father", sex: "M", birthOrder: 1 },
      { id: "mother", sex: "F", birthOrder: 2 },
      { id: "stepfather", sex: "M", birthOrder: 3 },
      { id: "proband", sex: "M", birthOrder: 4 },
      { id: "halfBrother", sex: "M", birthOrder: 5 }
    ],
    unions: [
      { id: "u1", partners: ["father", "mother"] },
      { id: "u2", partners: ["stepfather", "mother"] }
    ],
    childrenMap: [["u1", ["proband"]], ["u2", ["halfBrother"]]]
  };
  const result = okLayout(input);
  const nodes = byId(result);
  const mother = nodes.get("mother")!;
  const father = nodes.get("father")!;
  const stepfather = nodes.get("stepfather")!;
  assert.ok(Math.min(father.x, stepfather.x) < mother.x && mother.x < Math.max(father.x, stepfather.x));
  assertChildrenUnderOwnUnion(result, input);
});

test("对称性：颠倒每段婚姻的 partners 顺序后坐标完全一致", () => {
  const cases: LayoutInput[] = [
    twoSpouses("F", "M", [1, 1]),
    twoSpouses("M", "F", [1, 1]),
    twoSpouses("F", "M", [2, 0]),
    twoSpouses("U", "U", [1, 2])
  ];
  for (const input of cases) {
    const reversed: LayoutInput = {
      ...input,
      unions: input.unions.map((union) => ({ ...union, partners: [...union.partners].reverse() }))
    };
    assert.equal(positionsOf(okLayout(reversed)), positionsOf(okLayout(input)));
  }
});

test("一女两男且女方有父母和同胞：女方仍居中并保持与原生家庭连接，子女组之间留间隙", () => {
  for (const counts of [[1, 1], [2, 1], [2, 3]]) {
    const persons: LayoutInput["persons"] = [
      { id: "gf", sex: "M", birthOrder: 1 },
      { id: "gm", sex: "F", birthOrder: 2 },
      { id: "brother", sex: "M", birthOrder: 3 },
      { id: "P", sex: "F", birthOrder: 4 },
      { id: "S1", sex: "M", birthOrder: 5 },
      { id: "S2", sex: "M", birthOrder: 6 }
    ];
    const childrenMap: LayoutInput["childrenMap"] = [["origin", ["brother", "P"]]];
    let order = 7;
    counts.forEach((count, index) => {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const id = `C${index + 1}_${i + 1}`;
        persons.push({ id, sex: i % 2 ? "F" : "M", birthOrder: order++ });
        ids.push(id);
      }
      childrenMap.push([`u${index + 1}`, ids]);
    });
    const input: LayoutInput = {
      persons,
      unions: [
        { id: "origin", partners: ["gf", "gm"] },
        { id: "u1", partners: ["S1", "P"] },
        { id: "u2", partners: ["S2", "P"] }
      ],
      childrenMap
    };
    const result = okLayout(input);
    const nodes = byId(result);
    const p = nodes.get("P")!;
    assert.ok(nodes.get("S1")!.x < p.x && p.x < nodes.get("S2")!.x, `子女数 ${JSON.stringify(counts)}：女方应居中`);
    assert.ok(p.y > nodes.get("gf")!.y);
    assertChildrenUnderOwnUnion(result, input);
    assertNoSameGenerationOverlap(result);
    // 两组同母异父子女之间至少留一个同胞间距
    const lastOfFirst = nodes.get(`C1_${counts[0]}`)!;
    const firstOfSecond = nodes.get("C2_1")!;
    assert.ok(firstOfSecond.x - lastOfFirst.x >= PERSON_GAP - 0.5, `子女数 ${JSON.stringify(counts)}：两组子女之间应留间隙`);
  }
});
