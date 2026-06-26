import test from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/browser/entry";
import { LayoutInput } from "../src/model/layoutResult";

test("browser layout entry centers a proband under both parents", () => {
  const response = layout({
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      { id: "proband", sex: "U", birthOrder: 0 }
    ],
    unions: [
      { id: "u0", partners: ["father", "mother"] }
    ],
    childrenMap: [
      ["u0", ["proband"]]
    ]
  });

  assert.ok(response.ok);
  const result = response.layout;
  const byId = new Map(result.nodes.map((position) => [position.id, position]));
  const father = byId.get("father")!;
  const mother = byId.get("mother")!;
  const proband = byId.get("proband")!;

  assert.ok(Math.abs(proband.x - (father.x + mother.x) / 2) < 0.5);
  assert.ok(proband.y > father.y);
  assert.equal(father.y, mother.y);
  assert.equal(result.positions.length, 3);
  assert.ok(result.relationshipSegments.some((segment) => segment.type === "marriage"));
  assert.ok(result.relationshipSegments.some((segment) => segment.type === "descent"));
  assert.ok(result.unionAnchors.some((anchor) => anchor.unionId === "u0"));
  assert.ok(result.bounds.width > 0);
  assert.deepEqual(result.generationLabels.map((label) => label.label), ["I", "II"]);
});

test("browser layout entry keeps twin group adjacent for layout ordering", () => {
  const response = layout({
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      { id: "twinA", sex: "U", birthOrder: 0, twinGroup: "tw1", twinType: "identical" },
      { id: "other", sex: "U", birthOrder: 1 },
      { id: "twinB", sex: "U", birthOrder: 2, twinGroup: "tw1", twinType: "identical" }
    ],
    unions: [
      { id: "u0", partners: ["father", "mother"] }
    ],
    childrenMap: [
      ["u0", ["twinA", "other", "twinB"]]
    ]
  });

  assert.ok(response.ok);
  const byX = response.layout.nodes
    .filter((node) => ["twinA", "other", "twinB"].includes(node.id))
    .sort((a, b) => a.x - b.x)
    .map((node) => node.id);
  assert.deepEqual(byX.slice(0, 2), ["twinA", "twinB"]);
  assert.ok(response.layout.relationshipSegments.some((segment) =>
    segment.kind === "twin-bar" && segment.twinGroup === "tw1"
  ));
});

test("browser layout entry rejects duplicate childrenMap union entries before Map conversion", () => {
  const response = layout({
    ...validInput(),
    childrenMap: [
      ["u0", ["proband"]],
      ["u0", ["other"]]
    ]
  });

  assert.equal(response.ok, false);
  if (response.ok) throw new Error("expected duplicate childrenMap union entry to fail");
  assert.equal(response.error.code, "LAYOUT_INPUT_CHILDREN_MAP_UNION_DUPLICATE");
  assert.match(response.error.message, /duplicate union entry u0/);
});

test("browser layout entry rejects duplicate child ids inside one childrenMap entry", () => {
  const response = layout({
    ...validInput(),
    childrenMap: [
      ["u0", ["proband", "proband"]]
    ]
  });

  assert.equal(response.ok, false);
  if (response.ok) throw new Error("expected duplicate child id to fail");
  assert.equal(response.error.code, "LAYOUT_INPUT_CHILDREN_MAP_CHILD_DUPLICATE");
  assert.match(response.error.message, /duplicate child id proband/);
});

test("browser layout entry rejects empty partner ids before graph validation", () => {
  const response = layout({
    ...validInput(),
    unions: [
      { id: "u0", partners: ["father", ""] }
    ]
  });

  assert.equal(response.ok, false);
  if (response.ok) throw new Error("expected empty partner id to fail");
  assert.equal(response.error.code, "LAYOUT_INPUT_UNION_PARTNER_EMPTY");
});

function validInput(): LayoutInput {
  return {
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      { id: "proband", sex: "U", birthOrder: 0 },
      { id: "other", sex: "U", birthOrder: 1 }
    ],
    unions: [
      { id: "u0", partners: ["father", "mother"] }
    ],
    childrenMap: [
      ["u0", ["proband"]]
    ]
  };
}
