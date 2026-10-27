import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectRuntime} from '../addons/shared/install.mjs';
const runtime=(version,extra={})=>({api:1,version,files:{'forecast.js':'same'},...extra});
const plugin=r=>({meta:{sharedRuntime:r},shared:{'forecast.js':'bytes'}});
const old=runtime('1.0.0'),latest=runtime('1.1.0',{compatibleFrom:'1.0.0',files:{'forecast.js':'same','sampleCache.js':'new'}});
test('compatible runtime upgrade retains older plugins and never downgrades on removal',()=>{
 const plugins={arturia:plugin(latest),lavinia:plugin(old)};
 const selected=selectRuntime(plugins);assert.equal(selected.meta,latest);
 assert.equal(selectRuntime({lavinia:plugins.lavinia},selected).meta,latest);
 assert.equal(selectRuntime({lavinia:plugins.lavinia,zumama:plugin(latest)},selected).meta,latest);
});
test('reject same-version hash conflict, incompatible API and undeclared backward compatibility',()=>{
 assert.throws(()=>selectRuntime({a:plugin(old),b:plugin(runtime('1.0.0',{files:{'forecast.js':'different'}}))}),/differs/);
 assert.throws(()=>selectRuntime({a:plugin(old),b:plugin({...latest,api:2})}),/differs/);
 assert.throws(()=>selectRuntime({a:plugin(old),b:plugin(runtime('2.0.0'))}),/differs/);
 assert.throws(()=>selectRuntime({a:plugin(old),b:plugin(runtime('2.0.0',{compatibleFrom:'1.0.0'}))}),/differs/);
});
