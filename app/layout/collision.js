"use strict";

/* global window */

window.PedigreeLayout = window.PedigreeLayout || {};

function intervalsOverlap(a1, a2, b1, b2, gap) {
  return a1 < b2 + gap && b1 < a2 + gap;
}

window.PedigreeLayout.intervalsOverlap = intervalsOverlap;
