// Development regressions need the source fixtures; a runtime-only ZIP cannot certify them.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!fs.existsSync(new URL('../test/take-run.test.js',import.meta.url))){
 console.error('Development tests are not included in this runtime ZIP. Use the tested development source. Try the app sample or npm run replay -- --fast to inspect this package.');
 process.exit(1);
}
// Browser/media cases share physical CPU and device infrastructure. Bound file
// concurrency while retaining every test, timeout and assertion unchanged.
const tmp=path.join(root,'.tmp'),began=Date.now();
const result=spawnSync(process.execPath,['--test','--test-concurrency=4',...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
// A full run leaves about 1.5 GB of scratch folders in .tmp; thirteen runs of them filled the disk on 4 Oct 2026.
// Remove the mkdtemp folders this run made. Older folders, the reused fixtures (large-media, shells, walk) and files stay. YAP_KEEP_TMP=1 keeps everything.
if(process.env.YAP_KEEP_TMP!=='1'&&fs.existsSync(tmp)){
 let cleared=0;
 for(const name of fs.readdirSync(tmp)){
  if(!/-[A-Za-z0-9]{6}$/.test(name))continue;
  const dir=path.join(tmp,name);
  try{const st=fs.statSync(dir);if(!st.isDirectory()||st.birthtimeMs<began-1000)continue;fs.rmSync(dir,{recursive:true,force:true});cleared++;}catch{}
 }
 if(cleared)console.error(`cleared ${cleared} scratch folder(s) this run made in .tmp (YAP_KEEP_TMP=1 keeps them)`);
}
process.exit(result.status??1);
