// Development regressions need the source fixtures; a runtime-only ZIP cannot certify them.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!fs.existsSync(new URL('../test/take-run.test.js',import.meta.url))){
 console.error('Development tests are not included in this runtime ZIP. Use the tested development source. Try the app sample or npm run replay -- --fast to inspect this package.');
 process.exit(1);
}
// Browser/media cases share physical CPU and device infrastructure. Bound file
// concurrency while retaining every test, timeout and assertion unchanged.
const result=spawnSync(process.execPath,['--test','--test-concurrency=4',...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
process.exit(result.status??1);
