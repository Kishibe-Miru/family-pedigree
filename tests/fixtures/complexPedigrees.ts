import { LayoutInput } from "../../src/model/layoutResult";

export interface PedigreeFixture {
  id: string;
  description: string;
  input: LayoutInput;
}

export const simpleNuclearFamily: PedigreeFixture = {
  id: "simple-nuclear-family",
  description: "A two-parent union with one child.",
  input: {
    persons: [
      { id: "A", sex: "M" },
      { id: "B", sex: "F" },
      { id: "C", sex: "U", birthOrder: 0 }
    ],
    unions: [
      { id: "uAB", partners: ["A", "B"] }
    ],
    childrenMap: [
      ["uAB", ["C"]]
    ]
  }
};

export const multiChildSiblingGroup: PedigreeFixture = {
  id: "multi-child-sibling-group",
  description: "A shared parent union with three ordered children.",
  input: {
    persons: [
      { id: "A", sex: "M" },
      { id: "B", sex: "F" },
      { id: "C", sex: "U", birthOrder: 0 },
      { id: "D", sex: "U", birthOrder: 1 },
      { id: "E", sex: "U", birthOrder: 2 }
    ],
    unions: [
      { id: "uAB", partners: ["A", "B"] }
    ],
    childrenMap: [
      ["uAB", ["C", "D", "E"]]
    ]
  }
};

export const marriedSiblingWithOwnChild: PedigreeFixture = {
  id: "married-sibling-with-own-child",
  description: "One sibling has a spouse and child while remaining in the source sibling group.",
  input: {
    persons: [
      { id: "A", sex: "M" },
      { id: "B", sex: "F" },
      { id: "C", sex: "U", birthOrder: 0 },
      { id: "D", sex: "U", birthOrder: 1 },
      { id: "E", sex: "U" },
      { id: "F", sex: "U", birthOrder: 0 }
    ],
    unions: [
      { id: "uAB", partners: ["A", "B"] },
      { id: "uDE", partners: ["D", "E"] }
    ],
    childrenMap: [
      ["uAB", ["C", "D"]],
      ["uDE", ["F"]]
    ]
  }
};

export const spouseWithOriginFamily: PedigreeFixture = {
  id: "spouse-with-origin-family",
  description: "A spouse is also a child in a separate origin family.",
  input: {
    persons: [
      { id: "A", sex: "M" },
      { id: "B", sex: "F", birthOrder: 0 },
      { id: "C", sex: "U", birthOrder: 0 },
      { id: "P", sex: "M" },
      { id: "Q", sex: "F" }
    ],
    unions: [
      { id: "uAB", partners: ["A", "B"] },
      { id: "uPQ", partners: ["P", "Q"] }
    ],
    childrenMap: [
      ["uAB", ["C"]],
      ["uPQ", ["B"]]
    ]
  }
};

export const halfSiblingsThroughMultipleUnions: PedigreeFixture = {
  id: "half-siblings-through-multiple-unions",
  description: "One shared parent has children through two different unions.",
  input: {
    persons: [
      { id: "A", sex: "M" },
      { id: "B", sex: "F" },
      { id: "C", sex: "U", birthOrder: 0 },
      { id: "D", sex: "F" },
      { id: "E", sex: "U", birthOrder: 0 }
    ],
    unions: [
      { id: "uAB", partners: ["A", "B"] },
      { id: "uAD", partners: ["A", "D"] }
    ],
    childrenMap: [
      ["uAB", ["C"]],
      ["uAD", ["E"]]
    ]
  }
};

export const singleParentUnion: PedigreeFixture = {
  id: "single-parent-union",
  description: "A single parent union with one child.",
  input: {
    persons: [
      { id: "A", sex: "U" },
      { id: "C", sex: "U", birthOrder: 0 }
    ],
    unions: [
      { id: "uA", partners: ["A"] }
    ],
    childrenMap: [
      ["uA", ["C"]]
    ]
  }
};

export const threeGenerationChain: PedigreeFixture = {
  id: "three-generation-chain",
  description: "A three-generation descent chain with a married middle generation.",
  input: {
    persons: [
      { id: "G1A", sex: "M" },
      { id: "G1B", sex: "F" },
      { id: "G2A", sex: "U", birthOrder: 0 },
      { id: "G2B", sex: "U" },
      { id: "G3A", sex: "U", birthOrder: 0 }
    ],
    unions: [
      { id: "uG1", partners: ["G1A", "G1B"] },
      { id: "uG2", partners: ["G2A", "G2B"] }
    ],
    childrenMap: [
      ["uG1", ["G2A"]],
      ["uG2", ["G3A"]]
    ]
  }
};

export const complexKnownProblemFamily: PedigreeFixture = {
  id: "complex-known-problem-family",
  description: "Minimal known-problem shape: core siblings, two spouse origin families, and one married sibling subfamily.",
  input: {
    persons: [
      { id: "A1", sex: "M" },
      { id: "A2", sex: "F" },
      { id: "B1", sex: "M" },
      { id: "B2", sex: "F" },
      { id: "C1", sex: "M" },
      { id: "C2", sex: "F" },
      { id: "K1", sex: "U", birthOrder: 0 },
      { id: "K2", sex: "U", birthOrder: 1 },
      { id: "S1", sex: "U", birthOrder: 0 },
      { id: "S2", sex: "U", birthOrder: 0 },
      { id: "G1", sex: "U", birthOrder: 0 }
    ],
    unions: [
      { id: "uA", partners: ["A1", "A2"] },
      { id: "uB", partners: ["B1", "B2"] },
      { id: "uC", partners: ["C1", "C2"] },
      { id: "uK1S1", partners: ["K1", "S1"] },
      { id: "uK2S2", partners: ["K2", "S2"] }
    ],
    childrenMap: [
      ["uA", ["K1", "K2"]],
      ["uB", ["S1"]],
      ["uC", ["S2"]],
      ["uK1S1", ["G1"]],
      ["uK2S2", []]
    ]
  }
};

export const complexPedigreeFixtures = [
  simpleNuclearFamily,
  multiChildSiblingGroup,
  marriedSiblingWithOwnChild,
  spouseWithOriginFamily,
  halfSiblingsThroughMultipleUnions,
  singleParentUnion,
  threeGenerationChain,
  complexKnownProblemFamily
];
