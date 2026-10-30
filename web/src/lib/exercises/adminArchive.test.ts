/** Run the admin page's real archive callback with success/refusal transports. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../../app/(app)/dashboard/admin/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback = "";
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "confirmDeleteExercise") callback = node.initializer!.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert(callback);
const compiled = ts.transpileModule(`globalThis.archive = ${callback}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(fetch: () => Promise<any>) {
  const context: any = vm.createContext({
    deleteTargetId:"fixture",deleteTargetName:"Fixture guide",showDeleteConfirm:true,
    exercises:[{id:"fixture",name:"Fixture guide",archived_at:null}],fetch,console:{error(){}},
  });
  for (const [setter,field] of Object.entries({setExercises:"exercises",setShowDeleteConfirm:"showDeleteConfirm",
    setDeleteTargetId:"deleteTargetId",setDeleteTargetName:"deleteTargetName",setStatusModalType:"statusType",
    setStatusModalMsg:"statusMessage",setShowStatusModal:"showStatus"})) {
    context[setter] = (value: any) => { context[field] = typeof value === "function" ? value(context[field]) : value; };
  }
  vm.runInContext(compiled,context);
  return context;
}

async function main() {
  const refused = fixture(async()=>({ok:false,json:async()=>({error:"End the existing prescriptions first."})}));
  await refused.archive();
  assert.equal(refused.showStatus,true); assert.equal(refused.statusType,"error");
  assert.equal(refused.statusMessage,"End the existing prescriptions first.");
  assert.equal(refused.showDeleteConfirm,false); assert.equal(refused.deleteTargetId,null);
  assert.equal(refused.exercises[0].archived_at,null);

  const malformed = fixture(async()=>({ok:false,json:async()=>{throw new Error("not JSON");}}));
  await malformed.archive();
  assert.equal(malformed.showStatus,true); assert(malformed.statusMessage.includes("Unable to archive"));
  assert.equal(malformed.showDeleteConfirm,false);

  const network = fixture(async()=>{throw new Error("network unavailable");});
  await network.archive();
  assert.equal(network.showStatus,true); assert(network.statusMessage.includes("connection"));
  assert.equal(network.showDeleteConfirm,false); assert.equal(network.exercises[0].archived_at,null);

  const success = fixture(async()=>({ok:true}));
  await success.archive();
  assert.equal(success.exercises.length,1); assert.equal(typeof success.exercises[0].archived_at,"string");
  assert.equal(success.showDeleteConfirm,false); assert.equal(success.showStatus,undefined);

  const empty = fixture(async()=>{throw new Error("no request expected");});
  empty.deleteTargetId=null; await empty.archive();
  assert.equal(empty.showStatus,undefined);
  console.log("5/5 admin archive callback cases passed");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
