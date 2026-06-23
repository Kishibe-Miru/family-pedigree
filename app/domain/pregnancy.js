"use strict";

/* global window */

window.PedigreeDomain = window.PedigreeDomain || {};

/**
 * @typedef {Object} Pregnancy
 * @property {string} id
 * @property {string} unionId
 * @property {"current"|"miscarriage"|"stillbirth"|"termination"|"unknown"} outcome
 * @property {string[]} childIds
 * @property {string} notes
 */

function normalizePregnancy(input) {
  return {
    id: input.id,
    unionId: input.unionId || "",
    outcome: input.outcome || "unknown",
    childIds: [...new Set(input.childIds || [])],
    notes: input.notes || ""
  };
}

window.PedigreeDomain.normalizePregnancy = normalizePregnancy;
