"use strict";

/* global window */

window.PedigreeApplication = window.PedigreeApplication || {};

function command(name, doIt, undoIt) {
  return { name, do: doIt, undo: undoIt };
}

window.PedigreeApplication.command = command;
