// The extension is compiled to CommonJS, but these SDKs are ESM-only.
// Use a runtime dynamic import that TypeScript won't downlevel into require().
export async function dynamicImport<T = unknown>(specifier: string): Promise<T> {
  // eslint-disable-next-line no-new-func
  const loader = Function("s", "return import(s)") as (s: string) => Promise<T>;
  return loader(specifier);
}

