"use strict";

/* global window */

window.PedigreeApplication = window.PedigreeApplication || {};

function migrateProjectToSchema2(project, makeId) {
  if (!project || !Array.isArray(project.people)) throw new Error("invalid project");
  if (project.schemaVersion === 2 && Array.isArray(project.unions) && Array.isArray(project.parentages)) {
    return {
      schemaVersion: 2,
      version: project.version || "5.0",
      title: project.title || "家族谱系图",
      createdAt: project.createdAt || new Date().toISOString(),
      updatedAt: project.updatedAt || new Date().toISOString(),
      people: project.people,
      unions: project.unions || [],
      parentages: project.parentages || [],
      phenotypes: project.phenotypes || [],
      geneticFindings: project.geneticFindings || [],
      pregnancies: project.pregnancies || [],
      settings: project.settings || {},
      layout: project.layout || { positions: {} }
    };
  }

  throw new Error("旧树结构项目需要先转换为 schemaVersion 2 的谱系图模型");
}

window.PedigreeApplication.migrateProjectToSchema2 = migrateProjectToSchema2;
