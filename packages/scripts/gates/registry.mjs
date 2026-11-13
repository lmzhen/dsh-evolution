#!/usr/bin/env node
/**
 * The ONE gate registry (W10 M3): every check the family declares lives here.
 *
 * Consumers are generated views, never second lists:
 *   packages/scripts/gen-gate-manifest.mjs  -> gate-manifest.json + the CONTRIBUTING gate table
 *   packages/scripts/verify-gate-manifest.mjs -> compares registry <-> views <-> CI wiring
 *
 * Rules (enforced by validateRegistry in model.mjs):
 *   - ids are explicit and frozen; never derived from table row numbers or action ordering
 *   - every runnable row carries at least one run lane; machine-local rows carry exactly that lane
 *   - lanes are a closed set; unknown lanes fail generation
 *   - profiles are NOT stored: they derive from lanes (W10 §16.2)
 */
import { guards } from './guards.mjs'
import { release } from './release.mjs'
import { steps } from './steps.mjs'
import { unit } from './unit.mjs'

export const registry = [...guards, ...unit, ...release, ...steps]
