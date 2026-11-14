/**
 * userAge.test.ts — new accounts are for ages 13 to 100.
 *
 *   npx tsx src/lib/userAge.test.ts
 */
import assert from "node:assert/strict";
import { ageOnDay, birthDateBounds, birthDateError } from "./userAge";

const TODAY = "2026-11-07";

assert.deepEqual(birthDateBounds(TODAY), { max: "2013-11-07", min: "1925-11-08" });
assert.equal(ageOnDay("2013-11-07", TODAY), 13, "13 on the birthday");
assert.equal(ageOnDay("2013-11-08", TODAY), 12, "12 the day before");
assert.equal(ageOnDay("1925-11-08", TODAY), 100, "still 100 the day before turning 101");
assert.equal(ageOnDay("1925-11-07", TODAY), 101);

assert.equal(birthDateError("2013-11-07", TODAY), null, "13 is accepted");
assert.equal(birthDateError("1925-11-08", TODAY), null, "100 is accepted");
assert.equal(birthDateError("2013-11-08", TODAY), "The user must be at least 13 years old.");
assert.equal(birthDateError("1925-11-07", TODAY), "The user must be 100 years old or younger.");
assert.equal(birthDateError("", TODAY), "Date of birth is required.");
assert.equal(birthDateError(undefined, TODAY), "Date of birth is required.");
assert.equal(birthDateError("2001-02-30", TODAY), "Date of birth must be a valid date.");
assert.equal(birthDateError("not a date", TODAY), "Date of birth must be a valid date.");

// A leap day: born Feb 29, 2012 turns 13 on Mar 1 in a common year (Feb 28 bound).
assert.deepEqual(birthDateBounds("2028-02-29"), { max: "2015-02-28", min: "1927-03-01" });

console.log("userAge: ages 13 to 100 accepted, others refused — all passed");
