# 家族谱系图绘制工具

面向精神科临床、教学与科研场景的本地家系图绘制器。项目为纯前端应用，直接在浏览器中运行，不需要服务器，数据默认只保存在本机。

## 当前版本

当前 Git 主线中的 `家族谱系图工具/` 目录为最新版：

- 版本：5.2.1
- 日期：2026-06-26
- 入口文件：`家族谱系图工具/index.html`
- 详细说明：[`家族谱系图工具/使用说明.md`](%E5%AE%B6%E6%97%8F%E8%B0%B1%E7%B3%BB%E5%9B%BE%E5%B7%A5%E5%85%B7/%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E.md)

## 使用方式

直接双击打开：

```text
家族谱系图工具/index.html
```

推荐使用 Chrome、Edge 或 Firefox。

## 版本管理方式

这个仓库使用 Git tag 保存正式历史版本：

```text
v1.0
v2.0
v3.0
v3.1
v4.0
v4.1
v4.2
v4.3
v4.4
v4.5
v4.6
v4.7
v4.8
v5.0
v5.1
v5.2
v5.2.1
```

GitHub 主页面只保留 `家族谱系图工具/` 作为当前最新版。旧版可以通过对应 tag 或 Release 查看。

## 本地资料说明

本地开发目录中可能保留历史版本文件夹、参考项目和测试输出。这些目录用于人工查看和开发参考，不进入发布用 Git 主线。

## 开发说明

- 架构边界：`src/` 中的 graph engine 是专注的布局库，只负责校验布局输入、分代、排序、坐标、关系线段 metadata。
- 医学渲染本体保留在浏览器版 `家族谱系图工具/`：符号、图例、诊断/年龄/先证者/已故、导出视觉效果都由浏览器 UI 渲染。
- `src/render/svgRenderer.ts` 只作为引擎自测和调试 renderer，不作为第二套产品渲染器发展。
- Shared `LayoutResult` contract 位于 `src/model/layoutResult.ts`。
- `src/layout/layoutResultBuilder.ts` 负责从已布局 graph 构建 `LayoutResult`，以及将 manual 节点坐标合并回 finalized layout。
- `src/browser/entry.ts` 是浏览器适配层：校验 `LayoutInput`、调用 layout/builder，并暴露 `globalThis.PedigreeEngine`。
- 医学图形验收规则：连线端点按符号几何中心建模，普通关系尽量保持直线；只有避开同代符号、既有家系线或文字标签时才增加折线。人物编号、姓名、年龄/出生年、诊断和先证者 `P` 不得与符号或关系线重叠，`npm run test:e2e` 会检查常用场景的文本/符号/连线碰撞。
- `npm run test:e2e` 使用 Playwright Chromium；如果本机未安装浏览器，会自动 skip。需要完整运行时执行：

```bash
npx playwright install chromium
```

## 授权

当前未开放开源许可证。未经作者明确授权，请勿复制、分发或商用。
