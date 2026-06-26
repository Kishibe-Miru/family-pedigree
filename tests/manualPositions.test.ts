import test from "node:test";
import assert from "node:assert/strict";
import { applyManualNodePositionsToLayout } from "../src/layout/layoutResultBuilder";
import { LayoutInput, LayoutResult } from "../src/model/layoutResult";
import { layout } from "../src/browser/entry";

test("manual child coordinates rebuild the child relationship segment", () => {
  const input = familyInput();
  const engineLayout = buildLayout(input);
  const engineChild = findNode(engineLayout, "child");
  const manualX = engineChild.x + 180;
  const manualY = engineChild.y + 90;

  const finalLayout = applyManualNodePositionsToLayout({
    layout: engineLayout,
    people: [
      { id: "father" },
      { id: "mother" },
      { id: "child", manual: true, x: manualX, y: manualY }
    ],
    unions: input.unions,
    childrenMap: input.childrenMap
  });

  const finalChild = findNode(finalLayout, "child");
  assert.equal(finalChild.x, manualX);
  assert.equal(finalChild.y, manualY);
  assert.notEqual(finalChild.x, engineChild.x);
  assert.notEqual(finalChild.y, engineChild.y);

  const childSegment = finalLayout.relationshipSegments.find((segment) =>
    segment.type === "individual" && segment.personId === "child"
  );
  assert.ok(childSegment);
  const endpoint = childSegment.points[childSegment.points.length - 1];
  assert.deepEqual(endpoint, { x: manualX, y: manualY });
});

test("manual spouse coordinates rebuild the marriage segment", () => {
  const input: LayoutInput = {
    persons: [
      { id: "a", sex: "M" },
      { id: "b", sex: "F" }
    ],
    unions: [
      { id: "u0", partners: ["a", "b"] }
    ],
    childrenMap: []
  };
  const engineLayout = buildLayout(input);
  const nodeA = findNode(engineLayout, "a");
  const nodeB = findNode(engineLayout, "b");
  const manualX = nodeA.x + 260;
  const manualY = nodeA.y + 70;

  const finalLayout = applyManualNodePositionsToLayout({
    layout: engineLayout,
    people: [
      { id: "a" },
      { id: "b", manual: true, x: manualX, y: manualY }
    ],
    unions: input.unions,
    childrenMap: input.childrenMap
  });

  const finalB = findNode(finalLayout, "b");
  assert.equal(finalB.x, manualX);
  assert.equal(finalB.y, manualY);
  assert.notEqual(finalB.x, nodeB.x);

  const marriage = finalLayout.relationshipSegments.find((segment) => segment.type === "marriage");
  assert.ok(marriage);
  const endpoint = marriage.points[marriage.points.length - 1];
  assert.deepEqual(endpoint, { x: manualX, y: manualY });
});

test("non-manual nodes keep engine coordinates while rebuilding relationship segments", () => {
  const input = familyInput();
  const engineLayout = buildLayout(input);

  const finalLayout = applyManualNodePositionsToLayout({
    layout: engineLayout,
    people: [
      { id: "father" },
      { id: "mother" },
      { id: "child" }
    ],
    unions: input.unions,
    childrenMap: input.childrenMap
  });

  assert.deepEqual(finalLayout.nodes, engineLayout.nodes);
  assert.deepEqual(finalLayout.positions, engineLayout.positions);
  assert.ok(finalLayout.relationshipSegments.some((segment) => segment.type === "marriage"));
  assert.ok(finalLayout.relationshipSegments.some((segment) => segment.type === "descent"));
  assert.ok(finalLayout.relationshipSegments.some((segment) => segment.type === "individual"));
});

function familyInput(): LayoutInput {
  return {
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      { id: "child", sex: "U", birthOrder: 0 }
    ],
    unions: [
      { id: "u0", partners: ["father", "mother"] }
    ],
    childrenMap: [
      ["u0", ["child"]]
    ]
  };
}

function buildLayout(input: LayoutInput): LayoutResult {
  const response = layout(input);
  assert.ok(response.ok);
  return response.layout;
}

function findNode(layout: LayoutResult, id: string) {
  const node = layout.nodes.find((candidate) => candidate.id === id);
  assert.ok(node, `missing node ${id}`);
  return node;
}
