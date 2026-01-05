// Script to patch fonteditor-core for Workers compatibility
// Run as postinstall after fresh `bun install`
//
// This patches:
// 1. woff2/index.js - init() to accept ArrayBuffer directly
// 2. woff2/woff2.js - remove new Function() usage (blocked by Workers)

const fs = require('fs');
const path = require('path');

const PATCH_MARKER = '/* PATCHED_FOR_WORKERS */';

/**
 * Patch woff2.js to remove all `new Function()` usage which is blocked by Workers.
 */
function patchWoff2Js(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log('woff2.js not found:', filePath);
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(PATCH_MARKER)) {
    console.log('woff2.js already patched:', filePath);
    return true;
  }

  let patched = false;

  // Patch 1: createNamedFunction uses new Function() for naming
  const oldCreateNamedFunction = 'function createNamedFunction(name,body){name=makeLegalFunctionName(name);return new Function("body","return function "+name+"() {\\n"+\'    "use strict";\'+\"    return body.apply(this, arguments);\\n\"+\"};\\n\")(body)}';
  const newCreateNamedFunction = `${PATCH_MARKER} function createNamedFunction(name,body){return body}`;

  if (content.includes(oldCreateNamedFunction)) {
    content = content.replace(oldCreateNamedFunction, newCreateNamedFunction);
    console.log('  Patched createNamedFunction');
    patched = true;
  }

  // Patch 2: craftInvokerFunction builds dynamic wrappers with new Function
  // Original: return new Function("dynCall","rawFunction",body)(dynCall,rawFunction)
  // Replace with a generic wrapper that forwards all args
  const oldCraftInvoker = 'return new Function("dynCall","rawFunction",body)(dynCall,rawFunction)';
  const newCraftInvoker = 'return (function(dc,rf){return function(){var a=[rf];for(var i=0;i<arguments.length;i++)a.push(arguments[i]);return dc.apply(null,a)}})(dynCall,rawFunction)';

  if (content.includes(oldCraftInvoker)) {
    content = content.replace(oldCraftInvoker, newCraftInvoker);
    console.log('  Patched craftInvokerFunction (heap32RegisterType)');
    patched = true;
  }

  // Patch 3: craftInvokerFunction uses new_(Function,args1) for embind class methods
  // This is in the main craftInvokerFunction that builds invokers for bound classes
  // Pattern: args1.push(invokerFnBody);var invokerFunction=new_(Function,args1).apply(null,args2);return invokerFunction
  // Replace with a closure-based invoker that doesn't use dynamic code generation
  const oldEmbindInvoker = 'args1.push(invokerFnBody);var invokerFunction=new_(Function,args1).apply(null,args2);return invokerFunction';
  // Create a generic invoker closure that handles all the type conversion at runtime
  const newEmbindInvoker = `args1.push(invokerFnBody);
var invokerFunction=(function(throwBindingError,cppInvokerFunc,cppTargetFunc,runDestructors,argTypes,isClassMethodFunc,needsDestructorStack,returns,argCount){
return function(){
if(arguments.length!==(argCount-2)){throwBindingError("function called with "+arguments.length+" arguments, expected "+(argCount-2))}
var destructors=needsDestructorStack?[]:null;
var thisWired;
var argsWired=[];
var startArg=isClassMethodFunc?1:2;
if(isClassMethodFunc){thisWired=argTypes[1].toWireType(destructors,this)}
for(var i=0;i<argCount-2;++i){argsWired.push(argTypes[i+2].toWireType(destructors,arguments[i]))}
var invokeArgs=[cppTargetFunc];
if(isClassMethodFunc){invokeArgs.push(thisWired)}
for(var i=0;i<argsWired.length;++i){invokeArgs.push(argsWired[i])}
var rv=cppInvokerFunc.apply(null,invokeArgs);
if(needsDestructorStack){runDestructors(destructors)}
else{
if(isClassMethodFunc&&argTypes[1].destructorFunction){argTypes[1].destructorFunction(thisWired)}
for(var i=2;i<argTypes.length;++i){if(argTypes[i].destructorFunction){argTypes[i].destructorFunction(argsWired[i-2])}}
}
if(returns){return argTypes[0].fromWireType(rv)}
}
})(throwBindingError,cppInvokerFunc,cppTargetFunc,runDestructors,argTypes,isClassMethodFunc,needsDestructorStack,returns,argCount);return invokerFunction`;

  if (content.includes(oldEmbindInvoker)) {
    content = content.replace(oldEmbindInvoker, newEmbindInvoker);
    console.log('  Patched craftInvokerFunction (embind invoker)');
    patched = true;
  }

  if (patched) {
    fs.writeFileSync(filePath, content);
    console.log('Patched woff2.js:', filePath);
    return true;
  }

  // Check if there are still new Function calls we missed
  const remaining = (content.match(/new Function\(/g) || []).length;
  if (remaining > 0) {
    console.log(`WARNING: ${remaining} 'new Function(' calls remain unpatched in:`, filePath);
  }

  console.log('No patterns to patch in woff2.js:', filePath);
  return false;
}

/**
 * Patch woff2/index.js to accept ArrayBuffer for wasmUrl.
 */
function patchIndexJs(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log('index.js not found:', filePath);
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(PATCH_MARKER)) {
    console.log('index.js already patched:', filePath);
    return true;
  }

  // Original init function pattern (note: extra blank lines in original)
  const oldInit = `init(wasmUrl) {
        return new Promise((resolve) => {
            if (this.woff2Module) {
                resolve(this);
                return;
            }

            let moduleLoaderConfig = null;
            if (typeof window !== 'undefined') {
                moduleLoaderConfig = {
                    locateFile(path) {
                        if (path.endsWith('.wasm')) {
                            return wasmUrl;
                        }
                        return path;
                    },
                };
            }
            // for nodejs
            else {
                // Use path resolution that works in both ESM and CommonJS
                let wasmPath = './woff2.wasm';
                // If running in Node.js with __dirname available (CommonJS)
                if (typeof __dirname !== 'undefined') {
                    wasmPath = __dirname + '/woff2.wasm';
                }

                moduleLoaderConfig = {
                    wasmBinaryFile: wasmPath,
                };
            }
            const woffModule = woff2ModuleLoader(moduleLoaderConfig);
            woffModule.onRuntimeInitialized = () => {
                this.woff2Module = woffModule;
                resolve(this);
            };
        });
    }`;

  const newInit = `${PATCH_MARKER}
    init(wasmUrl) {
        return new Promise((resolve) => {
            if (this.woff2Module) {
                resolve(this);
                return;
            }
            let moduleLoaderConfig = null;
            // Support pre-compiled WebAssembly.Module (from wrangler CompiledWasm rule)
            if (wasmUrl instanceof WebAssembly.Module) {
                const wasmModule = wasmUrl;
                moduleLoaderConfig = {
                    instantiateWasm: function(info, receiveInstance) {
                        WebAssembly.instantiate(wasmModule, info).then(function(instance) {
                            receiveInstance(instance);
                        });
                        return {};
                    }
                };
            }
            // Support ArrayBuffer directly
            else if (wasmUrl instanceof ArrayBuffer || (wasmUrl && wasmUrl.buffer instanceof ArrayBuffer)) {
                moduleLoaderConfig = {
                    wasmBinary: wasmUrl instanceof ArrayBuffer ? wasmUrl : wasmUrl.buffer,
                };
            }
            // Browser with URL
            else if (typeof window !== 'undefined') {
                moduleLoaderConfig = {
                    locateFile(path) {
                        if (path.endsWith('.wasm')) {
                            return wasmUrl;
                        }
                        return path;
                    },
                };
            }
            // Node.js
            else {
                let wasmPath = './woff2.wasm';
                if (typeof __dirname !== 'undefined') {
                    wasmPath = __dirname + '/woff2.wasm';
                }
                moduleLoaderConfig = {
                    wasmBinaryFile: wasmPath,
                };
            }
            const woffModule = woff2ModuleLoader(moduleLoaderConfig);
            woffModule.onRuntimeInitialized = () => {
                this.woff2Module = woffModule;
                resolve(this);
            };
        });
    }`;

  if (content.includes(oldInit)) {
    content = content.replace(oldInit, newInit);
    fs.writeFileSync(filePath, content);
    console.log('Patched init() in:', filePath);
    return true;
  }

  console.log('init() pattern not found in:', filePath);
  return false;
}

// Find fonteditor-core in node_modules
const nodeModules = path.join(__dirname, '..', 'node_modules');
const bunCache = path.join(nodeModules, '.bun');

console.log('Patching fonteditor-core for Workers compatibility...');

let patchedIndex = false;
let patchedWoff2 = false;

// Try bun cache first (fonteditor-core@version/node_modules/fonteditor-core/woff2/...)
if (fs.existsSync(bunCache)) {
  const entries = fs.readdirSync(bunCache);
  for (const entry of entries) {
    if (entry.startsWith('fonteditor-core@')) {
      const baseDir = path.join(bunCache, entry, 'node_modules', 'fonteditor-core', 'woff2');
      const indexJs = path.join(baseDir, 'index.js');
      const woff2Js = path.join(baseDir, 'woff2.js');

      if (fs.existsSync(indexJs)) {
        patchedIndex = patchIndexJs(indexJs) || patchedIndex;
      }
      if (fs.existsSync(woff2Js)) {
        patchedWoff2 = patchWoff2Js(woff2Js) || patchedWoff2;
      }
    }
  }
}

// Also try root node_modules
const rootBaseDir = path.join(nodeModules, 'fonteditor-core', 'woff2');
const rootIndexJs = path.join(rootBaseDir, 'index.js');
const rootWoff2Js = path.join(rootBaseDir, 'woff2.js');

if (fs.existsSync(rootIndexJs)) {
  patchedIndex = patchIndexJs(rootIndexJs) || patchedIndex;
}
if (fs.existsSync(rootWoff2Js)) {
  patchedWoff2 = patchWoff2Js(rootWoff2Js) || patchedWoff2;
}

if (patchedIndex || patchedWoff2) {
  console.log('Patches applied:');
  if (patchedIndex) console.log('  - init() ArrayBuffer support');
  if (patchedWoff2) console.log('  - createNamedFunction new Function removal');
} else {
  console.log('No files patched - fonteditor-core may not be installed yet');
}
