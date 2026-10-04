/** The standalone demo must never export sample clinical data or imply sign-off. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../../../public/pt_session_summary_printable_report.html", import.meta.url), "utf8");
assert.equal(html, readFileSync(new URL("../../../../pt_session_summary_printable_report.html", import.meta.url), "utf8"));
const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
const fields = new Map<string, { value: string }>();
for (const match of markup.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
  const value = match[0].match(/\bvalue="([^"]*)"/)?.[1] ?? "";
  assert.equal(value, "", `${match[1]} must start blank`);
  fields.set(match[1], { value });
}
for (const match of markup.matchAll(/<textarea\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
  assert.equal(match[2], "", `${match[1]} must start blank`);
  fields.set(match[1], { value: match[2] });
}
assert(fields.size > 15);
assert.doesNotMatch(markup, /<input\b[^>]*\bchecked\b/);
assert.doesNotMatch(html, /Electronic Sign-off Timestamp|Licensed Physical Therapist Signature/);
assert.match(markup, /DEMO TEMPLATE — NOT A CLINICAL RECORD/);
assert.match(html, /@media print\s*\{\s*body::before\s*\{\s*content: "DEMO — NOT A CLINICAL RECORD"/);
const layout = readFileSync(new URL("../../app/(app)/dashboard/therapist/layout.tsx", import.meta.url), "utf8");
assert.doesNotMatch(layout, /href=.*session-report/, "prototype is absent from normal navigation");

const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].at(-1)![1];
const attributes: Record<string, string> = {};
const context = vm.createContext({
  window: {},
  document: {
    getElementById: (id: string) => { assert(fields.has(id), `unexpected field ${id}`); return fields.get(id); },
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute: (key: string, value: string) => { attributes[key] = value; }, click() {}, remove() {} }),
    body: { appendChild() {} },
  },
});
vm.runInContext(script, context);
context.downloadJSON();
const exported = JSON.parse(decodeURIComponent(attributes.href.split(",")[1]));
assert.equal(exported.reportType, "demo_template");
assert.equal(exported.clinicalRecord, false);
assert.match(exported.notice, /NOT A CLINICAL RECORD/);
assert.equal(exported.patientName, "");
assert.equal(exported.therapistName, "");
assert.equal(exported.prePainScore, null, "missing pain is not zero pain");
assert.equal(exported.postPainScore, null);
assert.deepEqual(exported.interventions, []);
assert.deepEqual(exported.homeExerciseProgram, []);
assert.match(attributes.download, /^DEMO_ONLY_/);
fields.get("prePain")!.value = "0";
fields.get("postPain")!.value = "3";
context.downloadJSON();
const entered = JSON.parse(decodeURIComponent(attributes.href.split(",")[1]));
assert.equal(entered.prePainScore, 0);
assert.equal(entered.postPainScore, 3);
assert.equal(entered.clinicalRecord, false);
console.log("Report prototype: blank defaults, demo provenance, missing pain and navigation boundaries passed.");
