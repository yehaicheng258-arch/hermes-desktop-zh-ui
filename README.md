# hermes-desktop-zh-ui · Hermes 桌面端中文界面

把 **Hermes 桌面端**里那些英文的技能卡片、插件目录、工具集页、连接器目录**就地换成简体中文**——
一个运行时插件，不修改 App 本体，不依赖官方中文语言包，卸载 = 删一个文件夹。

> 名字虽然是 zh-ui，它翻的不是 App 的按钮（那些官方中文语言包已经做了），
> 而是**数据里的英文**：SKILL.md 的 description、公共 catalog feed 的卡片文案、
> 工具集/连接器目录的描述、以及中文语言包还没覆盖到的 UI 回退串。

English: a runtime plugin for the Hermes desktop app that translates English
skill / plugin / toolset / connector copy into Simplified Chinese, in place.

---

## 安装（三条路，选一条）

**Hermes 数据目录**默认为 `%USERPROFILE%\.hermes`（Windows）或 `~/.hermes`；
如果你设置了 `HERMES_HOME`，以它为准。装了多个 profile 的，把路径里的
`desktop-plugins\` 换成 `profiles\<名字>\desktop-plugins\`。

### ① 一键脚本（推荐）

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/yehaicheng258-arch/hermes-desktop-zh-ui/main/install.ps1 | iex
```

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/yehaicheng258-arch/hermes-desktop-zh-ui/main/install.sh | bash
```

### ② 手动放文件

1. 下载 [`dist/plugin.js`](dist/plugin.js)
2. 放到 `%HERMES_HOME%\desktop-plugins\zh-ui\plugin.js`
   （Windows 默认：`C:\Users\<你>\.hermes\desktop-plugins\zh-ui\plugin.js`）
3. 不用重启：App 会监听这个目录，几秒内热载入

### ③ 自己构建（想覆盖你本机所有技能时最全）

```bash
git clone https://github.com/yehaicheng258-arch/hermes-desktop-zh-ui
cd hermes-desktop-zh-ui
python scripts/build_zh_ui.py --online        # 拉公共 feed + 只翻缺的词条 + 写入插件目录
```

需要 Python 3.10+；翻译走 OpenAI 兼容接口，默认 DeepSeek（`DEEPSEEK_API_KEY`，
可放在 `$HERMES_HOME/.env`），也支持 `ZH_API_URL` / `ZH_MODEL` 指向别的端点。

## 用起来

装好后，右下角状态栏会出现一个 **「中 123」** 小标：

| 操作 | 效果 |
|---|---|
| 点一下「中」 | 关掉 → 英文原样还原；再点 → 重新中文化 |
| `⌘K` → 「中文界面：开 / 关」 | 同上，键盘党用这个 |

开关状态会被记住，下次启动沿用。

## 原理（为什么不会翻错聊天内容）

```
词库（英文原文 → 中文）+ 精确整段匹配
   ↓ 只替换「某个文本节点整段文字 == 词库键」的节点
   ↓ 跳过 <pre> <code> <kbd> <textarea> <input> <select> <script> <style>、
     contenteditable、以及任何带 data-zh-skip 的祖先
   ↓ React 重渲染把节点写回英文时，MutationObserver 再翻一次
```

因为匹配要求**整段相等**，聊天正文、代码块、命令、文件路径天然不会被误伤；
代价是「词库里没有的英文」保持原样（宁可漏翻，不可错翻）。

## 覆盖了什么

| 数据源 | 说明 |
|---|---|
| `optional-skills/**/SKILL.md` | 官方技能目录的描述（Discover 页那些卡） |
| `skills/**/SKILL.md` | 你**本机已装**的技能（只在本地构建时合并，不进公共包） |
| 公共 skills feed | 每个分类取前 16 条（首页每个书架 + 「查看全部」头几屏） |
| 插件目录 | 插件 tab 全部卡片描述 |
| 工具集页 | 工具集标题 + 摘要行 |
| Connectors 页 | 托管连接器（门户公开目录）+ 本地 MCP 目录的描述 |
| `i18n/en*.ts` | 上游全部英文 UI 字面量，兜底中文语言包漏掉的 key |

公共包（`dist/plugin.js`）约 6000 条词条、1.8 MB，**不含任何本机私有内容**。
覆盖率约 94%，没翻的 400 多条全是 `/help`、`OAuth`、`Slack`、`clarify` 这类标识符——
**本来就不该翻**。

## 已知限制

- **搜索深处的长尾还是英文**：公共 skills feed 有 10 万+ 条，全翻不现实。
  想要更深：`python scripts/build_zh_ui.py --online --per-cat 60`。
- 词库是「构建时快照」，新上架的技能要重跑一次构建才变中文。
- 只影响**显示**，不改任何文件、不拦截模型输出，也不影响 Agent 读到的原文。

## 隐私与成本

- **运行时不联网**：插件只做本地字典替换，没有网络请求，没有后端。
- 构建时会把**界面英文串**（技能/插件/连接器的一句话描述、UI 标签）发给你自己的
  LLM 端点翻译一次；不发文件内容、不发聊天记录、不发任何本机路径。
- 成本：一次性，公共词库约 20 万 token（DeepSeek 量级 ≈ 一两块钱），之后全走本地缓存。

## 开发 / 测试

```bash
npm install          # 只装 jsdom（测试用）
npm test             # 引擎测试 16 项 + 插件契约测试 12 项，全绿才算数
```

| 文件 | 作用 |
|---|---|
| `plugin.template.js` | 插件源码（引擎 + 状态栏 chip + ⌘K 命令），`const DICT` 占位符由构建脚本填充 |
| `scripts/build_zh_ui.py` | 采集 → 翻译（带缓存）→ 生成 `plugin.js` |
| `scripts/make_core_dict.py` | 重新生成 `data/core-dict.json`（公共包用的词库） |
| `data/core-dict.json` | 公共词库（英文→中文），`--offline` 构建直接用它 |
| `dist/plugin.js` | 即装即用的成品（就是 core-dict 构建出来的那份） |
| `tests/` | jsdom 真实 DOM 测试 |

调试小抄：renderer 的 `console.log` 不会进 `logs/desktop.log`，但
`window.hermesDesktop.logLine()` 会——插件里的 `trace()` 走的就是这条路，
所以 `[zh-ui] ...` 的日志可以直接 `grep` 到（`miss|` 行是还没收录的英文，补词库就靠它）。

## License

MIT © 2026 Ye Haicheng (yehaicheng258-arch)

Hermes Agent 由 [Nous Research](https://nousresearch.com) 开发，本插件是独立的第三方扩展，
与官方无隶属关系。词库中的英文原文来自 Hermes 公开仓库与其公开 catalog feed。
