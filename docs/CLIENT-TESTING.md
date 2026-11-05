# Client testing and file inventory

## Commands and coverage scope

From the repository root in PowerShell:

```powershell
npm.cmd run test --workspace client
npm.cmd run test:watch --workspace client
npm.cmd run test:coverage --workspace client
npm.cmd run check
```

The coverage command uses Vitest's V8 provider. `vitest` and `@vitest/coverage-v8` must have matching versions; both are pinned to 5.0.4 in the client workspace. Use `npm.cmd ci` to restore the versions from the lockfile.

`client/vitest.config.ts` includes every runtime `.ts` and `.tsx` file under `client/src`, including the bootstrap, rather than counting only files imported by existing tests. Test files and `src/test/` fixtures/setup are excluded from the application percentage. SCSS, HTML and build configuration are not JavaScript runtime coverage targets. Shared modules outside `client/` have their own tests and are outside this client-only percentage.

The requested target is **100% statements, branches, functions and lines for each runtime file**, configured with `thresholds: { 100: true, perFile: true }`. Passing assertions alone does not satisfy the coverage gate. The coverage command exits unsuccessfully if any included file misses any target. Do not remove runtime files from the include list or add coverage-ignore comments to make the number pass.

The November 4, 2026 verification after source-ownership cleanup reached 100% for all 39 client runtime TypeScript files: 2,747 statements, 3,424 branches, 1,151 functions and 2,490 lines. Client-only test runs contain 460 tests across 37 files. The source-link helper now lives in `client/src` and counts toward this coverage; the seven VS Code compatibility tests live beside their shared helper and run with the shared suite.

Reports are generated in `client/coverage/`: `index.html` is the browsable report, `coverage-summary.json` contains totals and per-file percentages, and `coverage-final.json` contains individual execution counts. Reports are also written when assertions fail so uncovered paths remain inspectable. `npm.cmd run check` runs formatting, type checking, ESLint, Stylelint, all unit tests and the client build; use the separate coverage command to enforce the stricter client percentage gate.

UI tests use React Testing Library with jsdom and mock the HTTP/provider boundary. They exercise edits, approvals, explicit generation requests, media attachments, navigation, conflicts and recovery without contacting paid generation providers or the production database. Screen-level wiring tests use small child views to isolate parent callbacks; the actual child screens have separate interaction tests. Coverage measures execution, so assertions must also verify the resulting saved data or user-visible state.

## Test file naming

Keep tests beside the source file with the same base name and extension:

- `App.tsx` -> `App.test.tsx`
- `episode-draft.ts` -> `episode-draft.test.ts`
- `shared/vitest-vscode-compat.ts` -> `shared/vitest-vscode-compat.test.ts` (shared tooling, run by the shared suite)

Use `describe(...)` groups inside that file for component behavior, navigation, callbacks, workflow stages and recovery scenarios. Do not add separate `.wiring.test`, `.workflows.test` or `.stages.test` files. Component tests that use different child mocks set up those mocks within their group and remove them afterward. Test fixtures and setup remain in `src/test/`.

## VS Code Vitest warning

The installed Vitest Explorer **1.52.2** extension supplies this deprecated plugin option:

```ts
api.vitest.experimental.ignoreFsModuleCache = true;
```

Vitest 5 expects `api.vitest.ignoreFsModuleCache`. This warning originates in the extension's `vitest:vscode-extension` plugin, not in an application setting. Version 1.52.2 was the latest published release when checked on November 4, 2026.

`shared/vitest-vscode-compat.ts` is a compatibility plugin loaded by all three workspace Vitest configurations. It copies a true legacy cache opt-out to the current property before Vitest initializes its filesystem module cache. It preserves the extension's requested behavior and does not suppress warnings or modify files in the VS Code extension installation. Normal command-line runs without the extension are unchanged. Its matching shared test covers absent, old and modern plugin options. See [Shared testing](SHARED-TESTING.md) for its dedicated suite.

After pulling these files, stop the existing Vitest runner in VS Code and start it again so it reloads the config. Once the extension uses the current property itself, this compatibility plugin does nothing and can be removed with its tests and config import.

References: [Vitest filesystem module cache](https://main.vitest.dev/config/fsmodulecache), [Vitest coverage configuration](https://main.vitest.dev/config/coverage), and [Vitest Explorer 1.52.2 release](https://github.com/vitest-dev/vscode/releases/tag/v1.52.2).

## What the client files do

An import audit starts at `src/main.tsx` and follows both normal and lazy imports. Every current runtime source file is reachable. No obsolete runtime source file was identified for removal. The unused `endImageHref` export from the retired end-frame controls was removed from `review-navigation.ts`; it had no runtime callers.

`src/asset-source-links.ts` owns the source-link display helpers used by `AssetSourceEvidence.tsx`. It moved out of `/shared` because the server has no runtime consumer. Its matching test covers saved-link deduplication, URL safety and original-video timestamp links; the helper now counts toward client coverage.

| Files                                                                                                                                                                                                                   | Role                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `index.html`, `src/main.tsx`                                                                                                                                                                                            | Vite HTML entry and React root, authentication, theme                                                           |
| `src/App.tsx`, `src/theme.ts`, `src/styles.scss`                                                                                                                                                                        | Workspace navigation, overview, shared MUI theme and global styles                                              |
| `src/AssetLibrary.tsx`, `src/CharacterGeneration.tsx`, `src/CharacterSheets.tsx`, `src/AssetSourceEvidence.tsx`                                                                                                         | Creative library, character prompts, reference packages and saved source evidence                               |
| `src/Episodes.tsx`, `src/ProductionBoard.tsx`, `src/SceneBoardEditor.tsx`, `src/ShotProductionCard.tsx`, `src/ShotDisclosure.tsx`, `src/ShotImageReview.tsx`, `src/AnimaticPreview.tsx`                                 | Episode and scene editing, shot controls, approvals, timing and previews                                        |
| `src/ProductionInputs.tsx`, `src/SourceReferences.tsx`, `src/ImageRequestReferences.tsx`, `src/VideoReferenceEditor.tsx`                                                                                                | Source, continuity and image/video attachment selection                                                         |
| `src/ProductionChat.tsx`, `src/ProductionDrafts.tsx`, `src/ChatGPTConnection.tsx`, `src/AuthGate.tsx`                                                                                                                   | Contextual chat, revision application, provider connections and owner sign-in/account controls                  |
| `src/SceneMusic.tsx`, `src/SoundDesign.tsx`, `src/SeriesBible.tsx`                                                                                                                                                      | Section music, native/repair sound workflows and series settings                                                |
| `src/StudioMedia.tsx`, `src/RejectMediaButton.tsx`, `src/NativeVideoImport.tsx`                                                                                                                                         | Media library, uploads, rejection and native 1080p video imports                                                |
| `src/api.ts`, `src/project-url.ts`, `src/studio-events.ts`, `src/studio-utils.ts`, `src/episode-draft.ts`, `src/scene-board-draft.ts`, `src/continuity-selection.ts`, `src/review-navigation.ts`, `src/ReviewLinks.tsx` | HTTP, project routing, refresh notifications, recoverable drafts and review anchors                             |
| `src/**/*.test.ts`, `src/**/*.test.tsx`, `src/test/`                                                                                                                                                                    | Tests, typed fixtures and browser test setup; these are development files and are not imported by the app entry |
| `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`                                                                                                                                                   | Dependencies, TypeScript, development/build and test tooling                                                    |
| `dist/`, `coverage/`, `node_modules/`                                                                                                                                                                                   | Generated build, test reports and installed dependencies; ignored by Git and not source files                   |

The obsolete upscale UI, queue, import validation and approval stage have been retired. Server delivery selection retains read-only access to historical high-resolution files, without generating or importing another upscale. Unused one-time migrations, the old public-reference-sharing helper and superseded single-speaker parser were removed after a source-reference audit. Unused MUI data-grid/date-picker dependencies and the date-localization wrapper were also removed. Saved project data and media were not migrated or deleted by this source cleanup.
