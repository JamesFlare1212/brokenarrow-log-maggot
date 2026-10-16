# Repository Instructions

## Development Language

- Use English for new or modified code identifiers, comments, developer documentation, commit messages,
  pull request titles and descriptions, release notes, and CI workflow names, steps, and messages.
- Preserve localized application text and translation resources in their intended languages.
- Follow the existing TypeScript, React, Electron, and pnpm workspace conventions.

## Validation

- Run checks appropriate to the change. For application changes, use `pnpm check` for type checking,
  regression tests, and production builds, and `pnpm format:check` for formatting.
- For changes affecting desktop behavior, run `pnpm smoke`; use `pnpm smoke:real` when real-data
  behavior is affected.
- For documentation-only changes, check the formatting of the changed files.
- Report only checks that actually ran, including any failures or skipped checks. Use the actual
  regression test count from the current run.

## Releases

- Write release notes in English using the `Changes`, `Downloads`, and `Validation` sections below.
- Replace every placeholder with the actual release version, changes, and validation results. Do not
  copy an old version number or test count into a new release.
- Keep the root `package.json` version and stable release tag (`vX.Y.Z`) consistent.
- Include the Windows x64 installer, portable executable, `latest.yml`, and installer `.blockmap`
  file. Match download names to the generated artifacts.
- Verify packaged artifacts with `node scripts/verify-update-artifacts.mjs` and run the packaged
  Electron smoke tests before claiming that release validation passed.
- Publishing is triggered by pushing a version tag; manually running the build workflow only
  produces build artifacts.

Use this release notes template, adjusting validation bullets to reflect the checks actually run:

```markdown
## Changes

- <Describe a user-visible change in English.>

## Downloads

- `BrokenArrow-Setup-<VERSION>-x64.exe`: Windows x64 installer.
- `BrokenArrow-Portable-<VERSION>-x64.exe`: Windows x64 portable application.
- `latest.yml` and the `.blockmap` file support application updates.

## Validation

- <Describe checks/tests that passed/failed>
```
