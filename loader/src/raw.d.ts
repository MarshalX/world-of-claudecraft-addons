// Vite's ?raw suffix, which the host uses to inline the pre-bundled runtime.
//
// Declared as a wildcard module so a typecheck run does not need the generated
// bundle to exist yet.

declare module '*.js?raw' {
  const source: string;
  export default source;
}
