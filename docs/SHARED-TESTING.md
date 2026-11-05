# Shared testing

`shared/` is an npm workspace with its own TypeScript Vitest configuration. Run these commands from the repository root in PowerShell:

```powershell
npm.cmd run test --workspace shared
npm.cmd run test:watch --workspace shared
npm.cmd run test:coverage --workspace shared
npm.cmd exec --workspace shared -- vitest run shot-revisions.test.ts
```

`npm.cmd test` runs client, server, shared and launcher tests. `npm.cmd run test:coverage` runs the three workspace coverage commands. The server configuration selects only `server/src/**/*.test.ts`; shared tests are no longer included a second time by the server.

## Matching source and tests

Every shared source module has a neighboring test with the same base name: `image-references.ts` and `image-references.test.ts`, for example. Use groups inside that matching test file instead of separate `.wiring.test` or `.workflows.test` files. `types.test.ts` checks API and persisted-input contracts with `expectTypeOf`; the regular TypeScript check validates those assertions as well.

The Node environment runs the pure helpers without a browser. Some prompt regression tests also check the server's prompt assembly so previews and generation use the same reference and dialogue rules. These tests do not access saved Studio data or make paid generation requests. Shared runtime modules themselves must not import client or server implementations.

`vitest` and `@vitest/coverage-v8` are pinned to 5.0.4, matching the other workspaces. The shared config uses the same Vitest Explorer compatibility plugin as the client and server configs. Restart an existing editor test runner after changing its configuration.

## Coverage contract

The V8 provider includes all `shared/**/*.ts` source modules, including modules no test imports and any future subdirectories. Only `**/*.test.ts` and `vitest.config.ts` are excluded. All four metrics are enforced per file with `thresholds: { 100: true, perFile: true }`. Do not hide uncovered runtime code behind exclusions or coverage-ignore comments.

The November 4, 2026 verification passed **78 tests in 20 matching test files**, reaching **100% statements (699), branches (964), functions (219) and lines (575)**. All 19 executable modules are fully covered; `types.ts` contains erased TypeScript declarations and contributes no executable statements. Its contract test is still included in the suite.

Reports are generated in `shared/coverage/`:

- `index.html`: browsable source and branch coverage.
- `coverage-summary.json`: totals and per-file percentages.
- `coverage-final.json`: individual execution counts.

Reports are written after assertion failures too. Passing unit assertions does not imply passing the separate coverage gate. `npm.cmd run check` runs formatting, type checking, ESLint, Stylelint, all tests and the client build; use the coverage command to enforce the stricter percentages.

## Ownership and cleanup

An import audit confirmed that all remaining shared modules are used by both applications, directly or through other shared modules, or by their test configurations. No obsolete shared source files were found. Server-only and client-only helpers were already moved into their owning directories; see [source ownership](TYPESCRIPT.md#source-ownership).

Cleanup removed redundant render checks in scene-draft rebasing, since render revisions are handled and returned earlier, and a duplicate-name check in cast assignment, since speaker names are already unique before assignment. Regression tests cover rebasing conflicts, preserved media selections, independent shot revisions, attachment limits and ordering, dialogue parsing, sound cue timing, music prompts and the retired end-frame prompt cleanup.
