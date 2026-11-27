# Repository Instructions

## Brand

- 应用中文名，断箭蛐工具
- 应用英文名，BARadar

## UI Styling

- 在 React 的 `className` 值中使用 Tailwind CSS v4 工具类来实现布局、间距、排版、颜色、
  响应式行为和交互状态。不要为普通组件或页面编写手写 CSS。
- 组合使用现有的 shadcn/ui 组件及其变体，使用语义化主题 token，并使用 `cn()` 处理
  条件类名。
- 卡片和浮动内容表面必须使用共享的玻璃材质和语义化表面 token。
  应自定义共享的 shadcn 基础组件，而不是应用反色工具提示填充，或针对特定页面覆盖
  背景、边框、阴影、模糊或圆角。
- 手写 CSS 仅限于共享主题 token、浏览器或原生基础样式（例如 Electron 标题栏
  几何布局和滚动条）、强制颜色模式/减少动画、Shadow DOM 宿主，以及共享的计算布局
  变量。对于任何必要的例外，需说明原因。
- 不要使用选择器块或批量 `@apply` 包装来重新创建组件样式表。需要运行时值时，
  应结合 Tailwind 工具类使用 CSS 变量。
- 跨页面的设计规则变化时，更新[界面设计系统](design-system/broken-arrow/MASTER.md)。页面行为、业务逻辑和具体参数保留在源码中，不在规范里重复维护。

## Validation

- Run checks appropriate to the change. For application changes, use `pnpm check` for type checking,
  regression tests, and production builds, and `pnpm format:check` for formatting.
- For changes affecting desktop behavior, run `pnpm smoke`; use `pnpm smoke:real` when real-data
  behavior is affected.
- Keep Vitest as a single project with Node as its default environment. When upgrading Vitest,
  verify that it still recognizes the `'@vitest-environment jsdom'` directive in DOM test files.
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
