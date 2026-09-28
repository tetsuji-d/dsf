import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isPressModuleLoadError,renderPressModuleLoadError} from '../js/press-module-load-error.js';
const source=readFileSync('js/press.js','utf8');
for(const name of ['flow-press-publication-preparation','flow-press-local-release-planning','dsf-release-byte-sealing','flow-press-local-release-package','flow-press-horizon-release-handoff','flow-press-horizon-release-upload','flow-press-horizon-draft-write','dsf-font-registry','dsf-production-font-runtime','dsf-fixed-text-thumbnail-renderer']){
 assert.ok(source.includes("from './"+name+".js'"),name+' must load at startup');
 assert.ok(!source.includes("import('./"+name+".js')"),name+' must not fetch after deployment');
}
assert.ok(isPressModuleLoadError(new Error('wrapper',{cause:new Error('Failed to fetch dynamically imported module: old.js')})));
assert.equal(renderPressModuleLoadError(new Error('FONT_NOT_CERTIFIED'),x=>x,x=>x),null);
const markup=renderPressModuleLoadError(new Error('Failed to fetch dynamically imported module'),x=>x,x=>x);
assert.ok(markup.includes('exportDSP()'));assert.ok(markup.includes("switchRoom('editor')"));assert.ok(!markup.includes('location.reload'));
console.log('PASS Press startup dependencies and non-destructive recovery actions');
