const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDebtYear, YEAR_ERROR } = require("../src/services/customerDebt.service");

test("debt year accepts 2000 and the current calendar year", () => {
  assert.equal(parseDebtYear(2000), 2000);
  assert.equal(parseDebtYear(new Date().getFullYear()), new Date().getFullYear());
});

test("debt year rejects 1999 and future years with Arabic validation", () => {
  for (const value of [1999, new Date().getFullYear() + 1]) {
    assert.throws(() => parseDebtYear(value), (error) => error.message === YEAR_ERROR);
  }
});

test("debt year must be an integer", () => {
  assert.throws(() => parseDebtYear("2025.5"), (error) => error.message === YEAR_ERROR);
});
