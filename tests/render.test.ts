import test from "node:test";
import assert from "node:assert/strict";
import { buildPedigree } from "../src/core/engine";
import { PedigreeGraph } from "../src/model/pedigreeGraph";
import { Person, Sex } from "../src/model/person";

function person(id: string, sex: Sex, extra: Partial<Person> = {}): [string, Person] {
  return [id, { id, sex, ...extra }];
}

test("buildPedigree renders standard pedigree symbols and relationship lines", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      person("father", "M"),
      person("mother", "F"),
      person("c1", "U"),
      person("c2", "M", { affected: true }),
      person("c3", "F"),
      person("spouse", "F", { carrier: true }),
      person("g1", "M"),
      person("g2", "U")
    ]),
    unions: new Map([
      ["u0", { id: "u0", partners: ["father", "mother"] }],
      ["u1", { id: "u1", partners: ["c2", "spouse"] }]
    ]),
    childrenMap: new Map([
      ["u0", ["c1", "c2", "c3"]],
      ["u1", ["g1", "g2"]]
    ])
  };

  graph.persons.get("c1")!.birthOrder = 0;
  graph.persons.get("c2")!.birthOrder = 1;
  graph.persons.get("c3")!.birthOrder = 2;
  graph.persons.get("g1")!.birthOrder = 0;
  graph.persons.get("g2")!.birthOrder = 1;

  const svg = buildPedigree(graph);

  assert.match(svg, /<svg viewBox="[^"]+"/);
  assert.doesNotMatch(svg, /cx="0" cy="0"/);
  assert.match(svg, /<rect class="pedigree-symbol/);
  assert.match(svg, /<circle class="pedigree-symbol/);
  assert.match(svg, /<polygon class="pedigree-symbol/);
  assert.match(svg, /class="pedigree-line marriage-line"/);
  assert.match(svg, /class="pedigree-line sibling-line"/);
  assert.match(svg, /class="pedigree-line descent-line"/);

  const descentX = Number(readLineAttr(svg, "descent-line", "u1", "x1"));
  const siblingX1 = Number(readLineAttr(svg, "sibling-line", "u1", "x1"));
  const siblingX2 = Number(readLineAttr(svg, "sibling-line", "u1", "x2"));
  assert.ok(descentX >= Math.min(siblingX1, siblingX2));
  assert.ok(descentX <= Math.max(siblingX1, siblingX2));
});

function readLineAttr(svg: string, className: string, unionId: string, attr: string): string {
  const pattern = new RegExp(`<line class="pedigree-line ${className}" data-union="${unionId}"[^>]*\\s${attr}="([^"]+)"`);
  const match = svg.match(pattern);
  assert.ok(match, `missing ${className} ${attr} for ${unionId}`);
  return match[1];
}
