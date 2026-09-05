import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalToVisualPoint,
  oppositeDirection,
  sideAtVisualEnd,
  visualRestartToCanonical,
  visualToCanonicalPoint,
} from "./captureOrientation";

test("normaliza origen y destino con CDA atacando a derecha o izquierda", () => {
  const canonical = { x: 0.82, y: 0.31 };
  assert.deepEqual(visualToCanonicalPoint(canonical, "RIGHT"), canonical);
  assert.deepEqual(visualToCanonicalPoint({ x: 0.18, y: 0.31 }, "LEFT"), canonical);
  assert.deepEqual(canonicalToVisualPoint(canonical, "LEFT"), { x: 0.18, y: 0.31 });
});

test("infiere lado de córner y banda cercana respetando el flip", () => {
  assert.equal(sideAtVisualEnd("RIGHT", "RIGHT"), "FOR");
  assert.equal(sideAtVisualEnd("LEFT", "RIGHT"), "AGAINST");
  assert.equal(sideAtVisualEnd("LEFT", "LEFT"), "FOR");
  assert.deepEqual(
    visualRestartToCanonical({ end: "LEFT", band: "TOP", direction: "LEFT" }),
    { side: "FOR", spatialSide: "TOP" },
  );
  assert.equal(oppositeDirection("RIGHT"), "LEFT");
});
