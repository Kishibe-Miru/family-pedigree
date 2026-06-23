"use strict";

/* global window */

window.PedigreeApplication = window.PedigreeApplication || {};

function migrateProjectToSchema2(project, makeId) {
  if (!project || !Array.isArray(project.people)) throw new Error("invalid project");
  if (project.schemaVersion === 2 && Array.isArray(project.unions) && Array.isArray(project.parentages)) {
    return {
      ...project,
      schemaVersion: 2,
      unions: project.unions || [],
      parentages: project.parentages || [],
      phenotypes: project.phenotypes || [],
      geneticFindings: project.geneticFindings || [],
      pregnancies: project.pregnancies || [],
      layout: project.layout || { positions: {} },
      relationships: []
    };
  }

  const relationships = Array.isArray(project.relationships) ? project.relationships : [];
  const peopleById = new Map(project.people.map((p) => [p.id, p]));
  const unions = [];
  const unionByKey = new Map();
  const parentages = [];
  const phenotypes = [];
  const geneticFindings = [];

  const orderCoupleIds = (ids) => {
    if (ids.length < 2) return ids;
    const [aId, bId] = ids;
    const a = peopleById.get(aId), b = peopleById.get(bId);
    if (a?.sex === "male" && b?.sex !== "male") return [aId, bId];
    if (b?.sex === "male" && a?.sex !== "male") return [bId, aId];
    if (a?.sex === "female" && b?.sex !== "female") return [bId, aId];
    if (b?.sex === "female" && a?.sex !== "female") return [aId, bId];
    return (a?.order || 0) <= (b?.order || 0) ? [aId, bId] : [bId, aId];
  };
  const keyOf = (ids) => [...new Set(ids)].sort().join("|") || "single-parent";
  const ensureUnion = (partnerIds) => {
    const ids = orderCoupleIds([...new Set(partnerIds)]);
    const key = keyOf(ids);
    if (unionByKey.has(key)) return unionByKey.get(key);
    const union = {
      id: `u_${key.replace(/[^a-zA-Z0-9_-]+/g, "_") || makeId("u")}`,
      partnerIds: ids,
      status: ids.length === 1 ? "single-parent" : "partner",
      order: unions.length + 1
    };
    unions.push(union);
    unionByKey.set(key, union);
    return union;
  };

  relationships.filter((r) => r.type === "partner").forEach((r) => ensureUnion([r.person1, r.person2]));

  project.people.forEach((person) => {
    const parentIds = relationships
      .filter((r) => r.type === "parentChild" && r.child === person.id)
      .map((r) => r.parent)
      .filter((id) => peopleById.has(id));
    if (parentIds.length > 0) {
      const limited = orderCoupleIds([...new Set(parentIds)].slice(0, 2));
      const union = ensureUnion(limited);
      parentages.push({
        id: makeId("pa"),
        unionId: union.id,
        parentIds: limited,
        childId: person.id,
        kind: "biological"
      });
    }

    phenotypes.push({
      id: `ph_${person.id}`,
      personId: person.id,
      status: person.affectedStatus === "carrier" ? "unaffected" : (person.affectedStatus || "unaffected"),
      diagnoses: Array.isArray(person.diagnoses) ? person.diagnoses : [],
      ageOfOnset: "",
      source: ""
    });
    if (person.affectedStatus === "carrier") {
      geneticFindings.push({
        id: `gf_${person.id}`,
        personId: person.id,
        status: "carrier",
        gene: "",
        variant: "",
        source: ""
      });
    }
  });

  return {
    ...project,
    schemaVersion: 2,
    unions,
    parentages,
    phenotypes,
    geneticFindings,
    pregnancies: [],
    layout: {
      positions: Object.fromEntries(project.people.map((p) => [p.id, { x: p.x || 0, y: p.y || 0, manual: !!p.manual }]))
    },
    relationships: []
  };
}

window.PedigreeApplication.migrateProjectToSchema2 = migrateProjectToSchema2;
