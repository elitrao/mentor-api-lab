import { mkdir,copyFile,readdir,rm,stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root=new URL('../',import.meta.url),out=new URL('dist/',root);
// Only these browser files can become public assets. Never publish the repository root.
export const assets=['index.html','app.js','reports.js','style.css','favicon.svg'];
export async function build(){
 await mkdir(out,{recursive:true});
 // Only clear this fixed output directory; it is always inside this project.
 const outputPath=fileURLToPath(out);
 for(const entry of await readdir(out)){
  const target=new URL(encodeURIComponent(entry),out);
  if(!fileURLToPath(target).startsWith(outputPath))throw new Error('Output path escaped dist');
  await rm(target,{recursive:true,force:true});
 }
 let total=0;
 for(const file of assets){await copyFile(new URL(file,root),new URL(file,out));total+=(await stat(new URL(file,out))).size;}
 console.log(`Built ${assets.length} public assets (${total} bytes) in ${fileURLToPath(out)}`);
}
await build();
