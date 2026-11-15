"use strict";

const { createDepartmentFullEhScenario } = require("./department_full_eh_scenario");

function createDepartmentColdStartEhScenario(options) {
  const scenario = createDepartmentFullEhScenario({ ...options, holdEmployee: true });
  return {
    ...scenario,
    waitForActiveEmployee: scenario.waitForHeldEmployee,
    releasePendingProviderResponse: scenario.releaseHeldEmployee,
  };
}

module.exports = { createDepartmentColdStartEhScenario };
