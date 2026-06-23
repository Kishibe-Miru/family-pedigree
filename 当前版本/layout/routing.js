"use strict";

/* global window */

window.PedigreeLayout = window.PedigreeLayout || {};

function orthogonalSegment(x1, y1, x2, y2) {
  return { x1, y1, x2, y2 };
}

window.PedigreeLayout.orthogonalSegment = orthogonalSegment;
