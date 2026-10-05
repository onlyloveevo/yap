// Installs runtime assets inside this app only. npm dependency lifecycle scripts
// stay disabled: the unused native speech/image addons never run installers.
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
export async function prepareRuntime({root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),platform=process.platform,arch=process.arch,fetchImpl=fetch,log=console.log}={}){
 const ffdir=path.join(root,'node_modules','ffmpeg-static');
 const pkg=JSON.parse(fs.readFileSync(path.join(ffdir,'package.json'),'utf8'));
 const release=pkg['ffmpeg-static']['binary-release-tag'];
 if(!['darwin','linux','win32'].includes(platform)||!['arm64','x64','ia32'].includes(arch))throw new Error('This platform has no supported video runtime.');
 const binary=path.join(ffdir,platform==='win32'?'ffmpeg.exe':'ffmpeg');
 if(!fs.existsSync(binary)){
  const base=`https://github.com/eugeneware/ffmpeg-static/releases/download/${release}`;
  const fetchBytes=async url=>{const res=await fetchImpl(url,{signal:AbortSignal.timeout(90000)});if(!res.ok)throw new Error(`Runtime download failed (${res.status}).`);return Buffer.from(await res.arrayBuffer());};
  log('Downloading the video runtime into this app (no global installation).');
  const bytes=gunzipSync(await fetchBytes(`${base}/ffmpeg-${platform}-${arch}.gz`));
  const tmp=binary+'.download';fs.writeFileSync(tmp,bytes,{mode:0o755});
  const probe=spawnSync(tmp,['-version'],{timeout:10000,encoding:'utf8'});
  if(probe.status!==0)throw new Error('Downloaded video runtime could not start.');
  fs.renameSync(tmp,binary);
  for(const ext of ['README','LICENSE'])fs.writeFileSync(binary+'.'+ext,await fetchBytes(`${base}/${platform}-${arch}.${ext}`));
  fs.writeFileSync(path.join(ffdir,'yap-install-receipt.json'),JSON.stringify({package:pkg.version,release,platform,arch,sha256:createHash('sha256').update(bytes).digest('hex')},null,2));
 }
 const runtime=path.join(root,'node_modules','onnxruntime-web','dist');
 const vendor=path.join(root,'node_modules','@huggingface','transformers','dist');
 for(const name of fs.readdirSync(runtime))if(/^ort-wasm-[\w.-]+\.(wasm|mjs)$/.test(name))fs.copyFileSync(path.join(runtime,name),path.join(vendor,name));
 log('Local video and browser speech runtimes are ready.');
 return binary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)prepareRuntime().catch(e=>{console.error(e.message);process.exitCode=1;});
