import { NODE_SIZE } from "../layout/boxModel";
import { PedigreeGraph } from "../model/pedigreeGraph";
import { Person } from "../model/person";

const R = NODE_SIZE / 2;
const SIBSHIP_DROP = NODE_SIZE * 1.25;
const MARGIN = NODE_SIZE;

export function render(graph: PedigreeGraph): string {
  const people = [...graph.persons.values()].filter(hasCoordinates);
  const frame = computeFrame(people);
  const lines = renderRelationshipLines(graph);
  const nodes = people.map(renderPerson).join("");

  return `<svg viewBox="${frame.viewBox}" width="${frame.width}" height="${frame.height}" xmlns="http://www.w3.org/2000/svg">${style()}${lines}${nodes}</svg>`;
}

function renderRelationshipLines(graph: PedigreeGraph): string {
  let output = "";

  for (const union of graph.unions.values()) {
    const partners = union.partners
      .map((id) => graph.persons.get(id))
      .filter(hasCoordinates);

    if (partners.length === 2) {
      output += renderMarriageLine(union.id, partners[0], partners[1]);
    }

    const kids = (graph.childrenMap.get(union.id) ?? [])
      .map((id) => graph.persons.get(id))
      .filter(hasCoordinates);
    if (kids.length === 0 || partners.length === 0) continue;

    output += renderParentChildLines(union.id, partners, kids);
  }

  return output;
}

function renderMarriageLine(unionId: string, a: PersonWithCoordinates, b: PersonWithCoordinates): string {
  const left = a.x <= b.x ? a : b;
  const right = left === a ? b : a;

  if (Math.abs(left.y - right.y) < 0.5) {
    return `<line class="pedigree-line marriage-line" data-union="${escapeAttr(unionId)}" x1="${fmt(left.x + R)}" y1="${fmt(left.y)}" x2="${fmt(right.x - R)}" y2="${fmt(right.y)}"/>`;
  }

  const midX = (left.x + right.x) / 2;
  return `<polyline class="pedigree-line marriage-line" data-union="${escapeAttr(unionId)}" points="${fmt(left.x + R)},${fmt(left.y)} ${fmt(midX)},${fmt(left.y)} ${fmt(midX)},${fmt(right.y)} ${fmt(right.x - R)},${fmt(right.y)}"/>`;
}

function renderParentChildLines(
  unionId: string,
  partners: PersonWithCoordinates[],
  kids: PersonWithCoordinates[]
): string {
  const dropX = partners.length === 2
    ? ((partners[0].x + partners[1].x) / 2)
    : partners[0].x;
  const parentBottomY = partners.length === 2
    ? Math.max(partners[0].y, partners[1].y) + R
    : partners[0].y + R;
  const siblingY = Math.min(...kids.map((kid) => kid.y)) - SIBSHIP_DROP;
  const minKidX = Math.min(...kids.map((kid) => kid.x));
  const maxKidX = Math.max(...kids.map((kid) => kid.x));
  const unionAttr = escapeAttr(unionId);

  let output = `<line class="pedigree-line descent-line" data-union="${unionAttr}" x1="${fmt(dropX)}" y1="${fmt(parentBottomY)}" x2="${fmt(dropX)}" y2="${fmt(siblingY)}"/>`;

  if (kids.length > 1 || Math.abs(kids[0].x - dropX) >= 0.5) {
    output += `<line class="pedigree-line sibling-line" data-union="${unionAttr}" x1="${fmt(minKidX)}" y1="${fmt(siblingY)}" x2="${fmt(maxKidX)}" y2="${fmt(siblingY)}"/>`;
  }

  for (const kid of kids) {
    output += `<line class="pedigree-line child-line" data-union="${unionAttr}" data-person="${escapeAttr(kid.id)}" x1="${fmt(kid.x)}" y1="${fmt(siblingY)}" x2="${fmt(kid.x)}" y2="${fmt(kid.y - R)}"/>`;
  }

  return output;
}

function renderPerson(person: PersonWithCoordinates): string {
  const classes = `pedigree-symbol${person.affected ? " affected" : ""}`;
  const attrs = `class="${classes}" data-person="${escapeAttr(person.id)}"`;
  let symbol = "";

  if (person.sex === "M") {
    symbol = `<rect ${attrs} x="${fmt(person.x - R)}" y="${fmt(person.y - R)}" width="${NODE_SIZE}" height="${NODE_SIZE}"/>`;
  } else if (person.sex === "F") {
    symbol = `<circle ${attrs} cx="${fmt(person.x)}" cy="${fmt(person.y)}" r="${R}"/>`;
  } else {
    const points = [
      [person.x, person.y - R],
      [person.x + R, person.y],
      [person.x, person.y + R],
      [person.x - R, person.y]
    ].map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
    symbol = `<polygon ${attrs} points="${points}"/>`;
  }

  if (!person.carrier) return symbol;
  return `${symbol}<circle class="carrier-dot" data-person="${escapeAttr(person.id)}" cx="${fmt(person.x)}" cy="${fmt(person.y)}" r="${fmt(R * 0.18)}"/>`;
}

function computeFrame(people: PersonWithCoordinates[]): { viewBox: string; width: string; height: string } {
  if (people.length === 0) {
    return {
      viewBox: `${-MARGIN} ${-MARGIN} ${MARGIN * 2} ${MARGIN * 2}`,
      width: String(MARGIN * 2),
      height: String(MARGIN * 2)
    };
  }

  const minX = Math.min(...people.map((person) => person.x)) - R - MARGIN;
  const minY = Math.min(...people.map((person) => person.y)) - R - MARGIN;
  const maxX = Math.max(...people.map((person) => person.x)) + R + MARGIN;
  const maxY = Math.max(...people.map((person) => person.y)) + R + MARGIN;
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    viewBox: `${fmt(minX)} ${fmt(minY)} ${fmt(width)} ${fmt(height)}`,
    width: fmt(width),
    height: fmt(height)
  };
}

function style(): string {
  return `<style>
.pedigree-line{fill:none;stroke:#111;stroke-width:2;stroke-linecap:square;stroke-linejoin:miter}
.pedigree-symbol{fill:#fff;stroke:#111;stroke-width:2}
.pedigree-symbol.affected{fill:#111}
.carrier-dot{fill:#111;stroke:none}
</style>`;
}

type PersonWithCoordinates = Person & { x: number; y: number };

function hasCoordinates(person: Person | undefined): person is PersonWithCoordinates {
  return !!person && Number.isFinite(person.x) && Number.isFinite(person.y);
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
