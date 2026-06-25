import test from "node:test";
import assert from "node:assert/strict";
import { PedigreeGraph } from "../src/model/pedigreeGraph";
import { Person, Sex } from "../src/model/person";
import { GraphValidationError, validateGraph } from "../src/rules/validation";

function person(id: string, sex: Sex = "U"): [string, Person] {
  return [id, { id, sex }];
}

function graph(overrides: Partial<PedigreeGraph> = {}): PedigreeGraph {
  return {
    persons: new Map([
      person("parent1", "M"),
      person("parent2", "F"),
      person("child", "U"),
      person("other", "U")
    ]),
    unions: new Map([
      ["u0", { id: "u0", partners: ["parent1", "parent2"] }]
    ]),
    childrenMap: new Map([
      ["u0", ["child"]]
    ]),
    ...overrides
  };
}

test("rejects union with missing partner", () => {
  assertValidationError(
    graph({
      unions: new Map([
        ["u0", { id: "u0", partners: ["parent1", "missing"] }]
      ])
    }),
    "GRAPH_UNION_PARTNER_MISSING",
    /missing partner missing/
  );
});

test("rejects union with 3 partners", () => {
  assertValidationError(
    graph({
      unions: new Map([
        ["u0", { id: "u0", partners: ["parent1", "parent2", "other"] as unknown as [string, string] }]
      ])
    }),
    "GRAPH_UNION_PARTNER_COUNT",
    /must have 1 or 2 partners/
  );
});

test("rejects child id missing from persons", () => {
  assertValidationError(
    graph({
      childrenMap: new Map([
        ["u0", ["missing-child"]]
      ])
    }),
    "GRAPH_CHILD_MISSING",
    /missing child missing-child/
  );
});

test("rejects unknown union id in children map", () => {
  assertValidationError(
    graph({
      childrenMap: new Map([
        ["missing-union", ["child"]]
      ])
    }),
    "GRAPH_CHILDREN_UNION_MISSING",
    /missing union missing-union/
  );
});

test("rejects duplicate child parentage", () => {
  assertValidationError(
    graph({
      unions: new Map([
        ["u0", { id: "u0", partners: ["parent1"] }],
        ["u1", { id: "u1", partners: ["parent2"] }]
      ]),
      childrenMap: new Map([
        ["u0", ["child"]],
        ["u1", ["child"]]
      ])
    }),
    "GRAPH_CHILD_MULTIPLE_PARENT_UNIONS",
    /child child belongs to multiple parent unions/
  );
});

test("rejects parent-child cycle", () => {
  assertValidationError(
    graph({
      persons: new Map([
        person("a"),
        person("b")
      ]),
      unions: new Map([
        ["u0", { id: "u0", partners: ["a"] }],
        ["u1", { id: "u1", partners: ["b"] }]
      ]),
      childrenMap: new Map([
        ["u0", ["b"]],
        ["u1", ["a"]]
      ])
    }),
    "GRAPH_PARENT_CHILD_CYCLE",
    /cycle detected/
  );
});

test("accepts valid single-parent union", () => {
  const validGraph = graph({
    unions: new Map([
      ["u0", { id: "u0", partners: ["parent1"] }]
    ])
  });

  assert.equal(validateGraph(validGraph), validGraph);
});

test("accepts valid two-parent union", () => {
  const validGraph = graph();

  assert.equal(validateGraph(validGraph), validGraph);
});

function assertValidationError(graph: PedigreeGraph, code: string, message: RegExp) {
  assert.throws(
    () => validateGraph(graph),
    (error) => error instanceof GraphValidationError &&
      error.code === code &&
      message.test(error.message)
  );
}
