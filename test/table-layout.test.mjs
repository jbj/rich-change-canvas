import test from "node:test";
import assert from "node:assert/strict";
import { fitTableColumns } from "../src/table-layout.mjs";

test("Fitting columns stay at their intrinsic widths with all surplus on the right", () => {
  assert.deepEqual(fitTableColumns(1200, [180, 90, 80], [110, 24, 80]), [180, 90, 80]);
  assert.deepEqual(fitTableColumns(1200, [30, 90, 0], [110, 24, 0]), [30, 90, 0]);
  assert.deepEqual(fitTableColumns(350, [180, 90, 80], [110, 24, 80]), [180, 90, 80]);
});

test("Only the filename column shrinks until its minimum is reached", () => {
  const preferred = [600, 150, 80], minimum = [110, 24, 80];
  for (const available of [829, 640, 480, 340]) {
    assert.deepEqual(fitTableColumns(available, preferred, minimum), [available - 230, 150, 80]);
  }
  assert.deepEqual(preferred, [600, 150, 80]);
});

test("Stats wrap only after the filename reaches its minimum; indivisible charts keep their width", () => {
  assert.deepEqual(fitTableColumns(300, [600, 150, 80], [110, 24, 80]), [110, 110, 80]);
  assert.deepEqual(fitTableColumns(240, [600, 150, 80], [110, 24, 80]), [110, 50, 80]);
  assert.deepEqual(fitTableColumns(214, [600, 150, 80], [110, 24, 80]), [110, 24, 80]);
});

test("Several wrappable stats columns share pressure without shrinking a fixed chart", () => {
  assert.deepEqual(fitTableColumns(440, [500, 220, 120, 80], [110, 20, 20, 80]), [110, 160, 90, 80]);
});

test("Resizing back to a wide viewport restores natural widths, including very long paths and counts", () => {
  const preferred = [100_000, 20_000, 80], minimum = [112, 24, 80];
  assert.deepEqual(fitTableColumns(320, preferred, minimum), [112, 128, 80]);
  assert.deepEqual(fitTableColumns(150_000, preferred, minimum), preferred);
});

test("Fractional widths and impossible viewports stay finite, non-negative and within the available width", () => {
  for (const available of [0, 1, 50, 100, 150, 213.25, 319.75, 1200.5]) {
    const widths = fitTableColumns(available, [600.25, 150.5, 80], [110.25, 24, 80]);
    assert.ok(widths.every((width) => Number.isFinite(width) && width >= 0));
    assert.ok(widths.reduce((sum, width) => sum + width, 0) <= available + 1e-8);
    if (available < 831) assert.ok(Math.abs(widths.reduce((sum, width) => sum + width, 0) - available) < 1e-8);
  }
});

test("Invalid measurements surface explicitly instead of producing invalid CSS widths", () => {
  for (const args of [[NaN, [100], [10]], [100, [Infinity], [10]], [100, [100], []], [100, [-1], [0]]]) {
    assert.throws(() => fitTableColumns(...args), RangeError);
  }
});
