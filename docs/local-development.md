# Local Development

This guide explains the maintained local workflow for `be-home-for-desktop`.

## Prerequisites

- Node.js and npm
- Rust toolchain (`rustup`, `cargo`, `rustc`)
- The platform-specific prerequisites required by Tauri for your OS

## Repo-Local Commands

Install dependencies:

```bash
npm install
```

Run the renderer-only Vite dev server:

```bash
npm run dev
```

Run the full Tauri desktop shell:

```bash
npm run tauri dev
```

Build the renderer bundle:

```bash
npm run build
```

Run renderer tests only:

```bash
npm run test:renderer
```

Run Rust host tests only:

```bash
npm run test:host
```

Run the maintained desktop test suite:

```bash
npm run test
```

## What Works Before Rust Is Installed

If Rust tooling is not available yet, these commands still work for renderer-only work:

```bash
npm install
npm run dev
npm run test:renderer
```

These commands require the Rust toolchain because they invoke the Tauri host or Cargo:

```bash
npm run tauri dev
npm run test:host
npm run test
```

## Contributor Notes

- Keep the repo-local `npm` scripts current and discoverable.
- Prefer updating this guide when the supported local workflow changes.
- Keep player-facing copy in runtime code and contributor-facing guidance in `docs/`.
