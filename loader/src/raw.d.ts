// Module shapes imported as text. The `*.js?raw` wildcard lets a typecheck run before the
// runtime bundle has been generated.

declare module '*.js?raw' {
  const source: string;
  export default source;
}

declare module '*.json?raw' {
  const source: string;
  export default source;
}

// Generated files read as text by the suites that guard them against hand-edits.
declare module '*.d.ts?raw' {
  const source: string;
  export default source;
}

declare module '*.generated.ts?raw' {
  const source: string;
  export default source;
}

declare module '*.css' {
  const source: string;
  export default source;
}
