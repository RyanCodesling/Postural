/**
 * Names typed into the admin's Create and Edit forms lose their digits, and the
 * users API names the first field that still holds one.
 *
 *   npx tsx src/lib/personName.test.ts
 */
import assert from "node:assert/strict";
import { nameFieldWithDigits, stripNameDigits } from "./personName";

assert.equal(stripNameDigits("Fict1ional 2"), "Fictional ");
assert.equal(stripNameDigits("Mary-Ann O'Neil"), "Mary-Ann O'Neil", "letters and punctuation are kept");

assert.equal(nameFieldWithDigits({ firstName: "Fictional", lastName: "Fixture" }), null);
assert.equal(nameFieldWithDigits({ firstName: "Fictional", middleName: "B4", lastName: "Fixture3" }), "Middle Name");
assert.equal(nameFieldWithDigits({ lastName: "Fixture3" }), "Last Name", "a partial edit body is checked too");
assert.equal(nameFieldWithDigits({ firstName: 42 }), "First Name", "a name sent as a number is rejected");

console.log("personName: all assertions passed");
