# 更新日志 · Changelog

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.1] — 2026-11-01

### 修复

- `install.ps1` 改成**纯 ASCII 文案**。Windows PowerShell 5.1 会按 ANSI 解析没有 BOM 的
  `.ps1`，原来那句带「中」字的提示在一行安装后会输出乱码；现在提示改成 `zh`。
  安装行为本身不变，仍是下载 `dist/plugin.js` 到 `<HERMES_HOME>/desktop-plugins/zh-ui/`。

### 验证

- 全新克隆 → `npm ci && npm test`：引擎 16 项 + 插件契约 12 项全绿
- `install.ps1` 指向临时 `HERMES_HOME` 实跑：下载 1,859,506 字节，sha256 与仓库内
  `dist/plugin.js` 一致

## [1.0.0] — 2026-11-01

### 新增

- 首个公开版本：Hermes 桌面端运行时中文界面插件（`zh-ui`）
- 词库 6,055 条：官方 optional-skills、公共 skills feed（每分类前 16 条）、插件目录、
  工具集页、Connectors 页（门户公开目录 + 本地 MCP manifest）、上游 `i18n/en*.ts` 英文字面量
- 整段精确匹配 + 跳过 `pre/code/input/contenteditable/[data-zh-skip]`，聊天正文与代码永不被误翻
- 状态栏「中 N」开关、`⌘K` 命令、开关状态持久化
- 一行安装：`install.ps1` / `install.sh`；也提供 `dist/plugin.js` 手动安装
- 构建链：`scripts/build_zh_ui.py`（采集 → 翻译带缓存 → 生成）、`scripts/make_core_dict.py`
- 测试：jsdom 真实 DOM 的引擎测试与插件契约测试

[1.0.1]: https://github.com/yehaicheng258-arch/hermes-desktop-zh-ui/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/yehaicheng258-arch/hermes-desktop-zh-ui/releases/tag/v1.0.0
