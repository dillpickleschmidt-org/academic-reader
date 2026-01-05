// Type declarations for asset imports

declare module '*.woff2' {
  // Bun: file path string, Workers: ArrayBuffer (via wrangler rules)
  const content: string | ArrayBuffer;
  export default content;
}

declare module '*.wasm' {
  // Bun: file path string
  // Workers with CompiledWasm: WebAssembly.Module
  // Workers with Data: ArrayBuffer
  const content: string | ArrayBuffer | WebAssembly.Module;
  export default content;
}

declare module '*.css' {
  const content: string;
  export default content;
}
