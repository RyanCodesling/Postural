/**
 * The admin's Edit form sends clinical text and the therapist assignment only
 * when the admin changed them, so a therapist's newer edit or a reassignment
 * made while the form was open is kept.
 *
 *   npx tsx src/lib/adminUserEdit.test.ts
 */
import assert from "node:assert/strict";
import { adminEditBody } from "./adminUserEdit";

const loaded = {
  id: "fixture_patient", name: "Fictional Fixture", firstName: "Fictional", lastName: "Fixture",
  email: "fixture@example.invalid", role: "patient", therapistId: "fixture_therapist",
  diagnosis: "Loaded diagnosis", condition: null as string | null, prescription: "Loaded prescription",
};
const identity = { id: loaded.id, name: loaded.name, lastName: loaded.lastName, email: loaded.email, role: loaded.role };

assert.deepEqual(
  adminEditBody(loaded, { ...loaded, firstName: "Renamed" }),
  { ...identity, firstName: "Renamed" },
  "only the name changed: the clinical text and the assignment keep their saved values",
);
assert.deepEqual(
  adminEditBody(loaded, { ...loaded, diagnosis: "Admin's diagnosis", condition: "" }),
  { ...identity, firstName: loaded.firstName, diagnosis: "Admin's diagnosis" },
  "a changed field is sent; an emptied field that was already empty is not",
);
assert.deepEqual(
  adminEditBody(loaded, { ...loaded, condition: "New condition", prescription: "" }),
  { ...identity, firstName: loaded.firstName, condition: "New condition", prescription: "" },
  "adding text and clearing text are both changes",
);
assert.equal("therapistId" in adminEditBody(loaded, { ...loaded }), false, "the form never sends the assignment back");
console.log("PASS the admin's Edit form sends clinical text and the assignment only when the admin changed them");
