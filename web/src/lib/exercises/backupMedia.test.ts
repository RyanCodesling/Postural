/** Actual backup/verify functions with real disposable files and fake database
 * transports. No database connection or pg_dump of patient data is performed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../../../scripts/backup-local.ts",import.meta.url),"utf8");
const ast = ts.createSourceFile("backup-local.ts",source,ts.ScriptTarget.Latest,true);
const names=["filesUnder","copyMedia","checkMedia","backup","verify"];
const nodes=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text??""));
assert.equal(nodes.length,names.length);
const compiled=ts.transpileModule(nodes.map(node=>node.getText(ast)).join("\n"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;

async function main(){
  const root=fs.mkdtempSync(path.join(tmpdir(),"backup-media-regression-"));
  try{
    const web=path.join(root,"web"), recordings=path.join(root,"recordings"), guides=path.join(root,"guides");
    fs.mkdirSync(path.join(web,"src/lib/analytics"),{recursive:true});
    fs.writeFileSync(path.join(web,"src/lib/analytics/trendModelConfig.json"),"{}");
    fs.mkdirSync(recordings);fs.mkdirSync(guides);
    fs.writeFileSync(path.join(recordings,"fixture.webm"),"fixture recording bytes");
    fs.writeFileSync(path.join(guides,"ex_fixture.mp4"),"fixture guide bytes");
    let restored=false;
    const messages:string[]=[];
    const context:any=vm.createContext({...fs,web,resolve:path.resolve,join:path.join,relative:path.relative,
      liveDatabase:"fixture_live",COACHING_ALGORITHM_VERSION:"fixture",git:()=>null,
      setting:(name:string)=>name==="RECORDINGS_DIR"?recordings:name==="EXERCISE_VIDEOS_DIR"?guides:null,
      sha256:(file:string)=>createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
      rowCounts:async(database:string)=>database==="fixture_live"||restored?{exercises:3}:{},
      run:(command:string,args:string[])=>{
        if(command==="pg_dump")fs.writeFileSync(args.find(arg=>arg.startsWith("--file="))!.slice(7),"fixture dump");
        else if(command==="pg_restore")restored=true;
        else throw new Error("Unexpected database tool");
      },process:{exitCode:undefined},console:{log:(text:string)=>messages.push(text)},
    });
    vm.runInContext(compiled,context);
    const out=path.join(root,"backup");await context.backup(out);
    const manifest=JSON.parse(fs.readFileSync(path.join(out,"manifest.json"),"utf8"));
    assert.equal(manifest.exerciseVideos.source,guides);
    assert.equal(manifest.exerciseVideos.files.length,1);
    assert.equal(fs.readFileSync(path.join(out,"exercise-videos/ex_fixture.mp4"),"utf8"),"fixture guide bytes");
    assert.equal(fs.readFileSync(path.join(guides,"ex_fixture.mp4"),"utf8"),"fixture guide bytes");
    await context.verify(out,"fixture_restore");
    assert.equal(context.process.exitCode,undefined);
    assert(messages.some(line=>line.includes("1 exercise guide files matching their hashes")));

    restored=false;fs.writeFileSync(path.join(out,"exercise-videos/ex_fixture.mp4"),"corrupted");
    await context.verify(out,"fixture_restore");
    assert.equal(context.process.exitCode,1,"a corrupt guide fails restore verification");

    restored=false;context.process.exitCode=undefined;
    delete manifest.exerciseVideos;fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify(manifest));
    await context.verify(out,"fixture_restore");
    assert.equal(context.process.exitCode,undefined,"older manifests remain verifiable");

    context.setting=(name:string)=>name==="RECORDINGS_DIR"?recordings:path.join(root,"no-guides");
    const empty=path.join(root,"empty-guide-backup");await context.backup(empty);
    assert.equal(JSON.parse(fs.readFileSync(path.join(empty,"manifest.json"),"utf8")).exerciseVideos.files.length,0);

    context.setting=(name:string)=>name==="RECORDINGS_DIR"?recordings:guides;
    context.cpSync=(source:string,destination:string,options:fs.CopySyncOptions)=>{
      if(source===guides)throw new Error("guide copy failed");
      fs.cpSync(source,destination,options);
    };
    const failed=path.join(root,"failed-backup");
    await assert.rejects(()=>context.backup(failed),/guide copy failed/);
    assert.equal(fs.existsSync(path.join(failed,"manifest.json")),false);
    console.log("5/5 backup media cases passed: copied, verified, corruption rejected, legacy/missing guides supported, copy failure propagated");
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
