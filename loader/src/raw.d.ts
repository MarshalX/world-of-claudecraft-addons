// The non-TypeScript module shapes this project imports as text.
//
// `*.js?raw` is Vite's raw suffix, which the host uses to inline the pre-bundled
// runtime; declaring it as a wildcard means a typecheck run does not need the
// generated bundle to exist yet. `*.css` is the loader stylesheet, which
// loader/build-runtime.mjs loads as text so it can be injected as one <style>.

declare module '*.js?raw' {
  const source: string;
  export default source;
}

declare module '*.json?raw' {
  const source: string;
  export default source;
}

// A generated declaration file read as TEXT, which is how the suite that guards
// it against hand-edits compares it with what its generator writes.
declare module '*.d.ts?raw' {
  const source: string;
  export default source;
}

declare module '*.css' {
  const source: string;
  export default source;
}
