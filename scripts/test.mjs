import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const outDir='.build-cache/tests';
await mkdir(outDir,{recursive:true});
// The Node auth boundary is pre-bundled to a real file so external packages resolve normally.
await build({entryPoints:['lib/auth.ts'],bundle:true,platform:'node',format:'esm',outfile:`${outDir}/lib-auth.mjs`,packages:'external'});
const names=['meta', 'runtime', 'auth', 'media-cooldown', 'media-storage', 'media-callers', 'media-retention', 'container-image', 'compose-stack', 'readiness', 'backup-ops', 'select-hydration', 'load-env', 'dev-origins'];
for (const name of names) {
  await build({entryPoints:[`tests/${name}.test.ts`],bundle:true,platform:'node',format:'esm',outfile:`${outDir}/${name}.test.mjs`,packages:'external'});
}
const result=spawnSync(process.execPath,['--test',...names.map(name=>`${outDir}/${name}.test.mjs`)],{stdio:'inherit'});
process.exit(result.status??1);
