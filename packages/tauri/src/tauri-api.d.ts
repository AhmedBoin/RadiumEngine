// src/tauri-api.d.ts — optional dependency declarations.
//
// `@tauri-apps/api` is NOT a dependency of this package: an application that uses
// the accelerator has it, a browser build does not. Declaring the two functions
// we call keeps the package compiling in both cases (the dynamic import fails
// gracefully at runtime when the module is missing).
declare module "@tauri-apps/api/core" {
  export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

declare module "@tauri-apps/api/event" {
  export function listen<T>(
    event: string,
    handler: (event: { payload: T }) => void,
  ): Promise<() => void>;
}
