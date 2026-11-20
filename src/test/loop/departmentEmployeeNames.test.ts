import test = require("node:test");
import assert = require("node:assert/strict");
import { DEPARTMENT_EMPLOYEE_NAMES, getDepartmentEmployeeName } from "../../departmentEmployeeNames";

test("department roster contains 100 unique two-character Chinese names", () => {
  assert.equal(DEPARTMENT_EMPLOYEE_NAMES.length, 100);
  assert.equal(new Set(DEPARTMENT_EMPLOYEE_NAMES).size, 100);
  assert.ok(DEPARTMENT_EMPLOYEE_NAMES.every((name) => /^\p{Script=Han}{2}$/u.test(name)));
});

test("department leader slots distribute names and reuse their own roster in order", () => {
  const names = Array.from({ length: 100 }, (_, index) => getDepartmentEmployeeName(index % 4 + 1, 4, Math.floor(index / 4) + 1));
  assert.deepEqual(names, [...DEPARTMENT_EMPLOYEE_NAMES]);
  assert.equal(getDepartmentEmployeeName(1, 4, 26), "王磊");
  assert.equal(getDepartmentEmployeeName(5, 4, 1), "王磊");
  assert.equal(getDepartmentEmployeeName(3, 3, 34), "张伟");
  assert.equal(getDepartmentEmployeeName(100, 101, 1), "施慧");
  assert.equal(getDepartmentEmployeeName(101, 101, 1), "王磊");
});
