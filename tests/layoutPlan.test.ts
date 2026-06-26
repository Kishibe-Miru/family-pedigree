import test from "node:test";
import assert from "node:assert/strict";
import { buildLayoutPlan } from "../src/layout/layoutPlan";
import { PedigreeGraph } from "../src/model/pedigreeGraph";

test("layout plan derives sibling order from relationship groups and keeps twins adjacent", () => {
  const graph = graphFrom({
    people: [
      ["father", { sex: "M" }],
      ["mother", { sex: "F" }],
      ["twinA", { twinGroup: "tw1", birthOrder: 0 }],
      ["other", { birthOrder: 1 }],
      ["twinB", { twinGroup: "tw1", birthOrder: 2 }]
    ],
    unions: [
      ["u0", ["father", "mother"]]
    ],
    childrenMap: [
      ["u0", ["twinA", "other", "twinB"]]
    ]
  });

  const plan = buildLayoutPlan(graph);
  const siblingGroup = plan.siblingGroups.find((group) => group.unionId === "u0");

  assert.ok(siblingGroup);
  assert.deepEqual(siblingGroup.parentIds, ["father", "mother"]);
  assert.deepEqual(siblingGroup.childIds, ["twinA", "other", "twinB"]);
  assert.deepEqual(siblingGroup.orderedChildIds, ["twinA", "twinB", "other"]);
});

test("layout plan exposes origin-family separation constraints for spouse-origin pedigrees", () => {
  const graph = graphFrom({
    people: [
      ["A", { sex: "M" }],
      ["B", { sex: "F", birthOrder: 0 }],
      ["C", {}],
      ["P", { sex: "M" }],
      ["Q", { sex: "F" }]
    ],
    unions: [
      ["uAB", ["A", "B"]],
      ["uPQ", ["P", "Q"]]
    ],
    childrenMap: [
      ["uAB", ["C"]],
      ["uPQ", ["B"]]
    ]
  });

  const plan = buildLayoutPlan(graph);

  assert.ok(plan.relationshipGroups.groups.some((group) =>
    group.kind === "origin-family" && group.unionId === "uPQ"
  ));
  const separation = plan.originSeparations.find((constraint) => constraint.sharedPersonId === "B");
  assert.ok(separation);
  assert.equal(separation.originUnionId, "uPQ");
  assert.equal(separation.coreUnionId, "uAB");
  assert.deepEqual(separation.personIds, ["B"]);
});

function graphFrom(input: {
  people: Array<[string, { sex?: "M" | "F" | "U"; birthOrder?: number; twinGroup?: string }]>;
  unions: Array<[string, [string, string] | [string]]>;
  childrenMap: Array<[string, string[]]>;
}): PedigreeGraph {
  return {
    persons: new Map(input.people.map(([id, person]) => [
      id,
      {
        id,
        sex: person.sex ?? "U",
        birthOrder: person.birthOrder,
        twinGroup: person.twinGroup
      }
    ])),
    unions: new Map(input.unions.map(([id, partners]) => [
      id,
      { id, partners }
    ])),
    childrenMap: new Map(input.childrenMap.map(([unionId, childIds]) => [unionId, [...childIds]]))
  };
}
