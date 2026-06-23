"use strict";

/* global window */

window.PedigreeDomain = window.PedigreeDomain || {};

/**
 * @typedef {"male"|"female"|"unknown"} Sex
 * @typedef {"unaffected"|"affected"|"suspected"|"carrier"|"unknown"} AffectedStatus
 * @typedef {Object} Person
 * @property {string} id
 * @property {string} name
 * @property {Sex} sex
 * @property {string} age
 * @property {string} birthYear
 * @property {boolean} deceased
 * @property {boolean} proband
 * @property {string} notes
 * @property {string} twinGroup
 * @property {"fraternal"|"identical"} twinType
 * @property {number} order
 */

/**
 * @param {Partial<Person> & { id: string, order: number }} input
 * @returns {Person}
 */
function normalizePerson(input) {
  return {
    id: input.id,
    name: input.name || "",
    sex: ["male", "female", "unknown"].includes(input.sex) ? input.sex : "unknown",
    age: input.age || "",
    birthYear: input.birthYear || "",
    deceased: !!input.deceased,
    proband: !!input.proband,
    notes: input.notes || "",
    twinGroup: input.twinGroup || "",
    twinType: input.twinType === "identical" ? "identical" : "fraternal",
    order: Number.isFinite(input.order) ? input.order : 0
  };
}

window.PedigreeDomain.normalizePerson = normalizePerson;
