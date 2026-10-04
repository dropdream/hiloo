# Repository Guidelines

## Project Structure & Module Organization

hiloo is a local Markdown editor for Windows, built with Electron, React, TypeScript, and Milkdown/ProseMirror.

- `src/main/`: window lifecycle, native dialogs, document I/O, and IPC validation.
- `src/preload/`: the restricted bridge between Electron and the renderer.
- `src/shared/`: shared types, Markdown rules, limits, and native window colors.
- `src/renderer/src/`: React components, editor behavior, CSS Modules, and global styles. Icons live in `Icon.tsx`; there is no dedicated asset directory.
- `tests/`: Playwright specifications and shared Electron fixtures.
- `docs/`: Markdown behavior, interface design, and audit notes. Consult `STACK.md` for implemented versus planned features.

## Build, Test, and Development Commands

Use Windows x64 with Node.js `^22.12.0 || >=24.0.0` and npm. Run commands from the repository root.

- `npm ci`: install locked dependencies.
- `npm run dev`: launch Electron with development reloads.
- `npm run typecheck`: check application, configuration, and test types.
- `npm run build`: typecheck and compile into `out/`.
- `npm start`: open the production preview.
- `npm run pack:win`: build `dist/win-unpacked/hiloo.exe`.
- `npm run dist:win`: build the Windows NSIS installer without publishing.
- `npm test`: run both local and packaged Playwright projects; run `npm run pack:win` first.
- `npm run test:packaged`: test the existing Windows package only.

## Coding Style & Naming Conventions

Follow existing TypeScript style: two-space indentation, single quotes, no semicolons, and strict typing. Use PascalCase for React components and types, camelCase for functions and variables, and kebab-case for multiword utility filenames. Keep component styles in matching `*.module.css` files. Preserve Spanish interface copy and accessible names. No ESLint or Prettier configuration is currently provided.

## Testing Guidelines

Name tests `tests/*.spec.ts` and reuse `tests/fixtures.ts`. Tests launch real Electron, use temporary files, and simulate native dialog choices. Add regression coverage for changed behavior, especially Markdown round-trips, save conflicts, keyboard interaction, and isolation. No numerical coverage threshold is configured. Outputs belong in ignored `.verification/`. For local-only checks, build first, then run `npm test -- --project=local`.

## Commit & Pull Request Guidelines

Recent feature commits use `feat: <short imperative description>`. Follow that style for features. PR descriptions should explain behavior changes, link relevant issues, report validation commands/results, and include screenshots for UI changes. Update documentation when supported Markdown or interface behavior changes.

## Security Boundaries

Preserve context isolation, sandboxing, disabled renderer Node integration, and validated IPC. Keep filesystem access in the main process behind narrow preload APIs.
