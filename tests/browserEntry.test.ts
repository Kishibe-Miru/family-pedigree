import test from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/browser/entry";

test("browser layout entry centers a proband under both parents", () => {
  const result = layout({
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

  assert.ok(result);
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
