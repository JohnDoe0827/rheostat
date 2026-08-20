# dsh-rheostat（滑动变阻器）

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的会话风格变阻器：一个 [0, 1] 之间的位置，在 **0 模式**（极简、安静、克制）与 **1 模式**（饱满、生动、详细）之间滑动切换模型的回答风格，中间位置按比例混合。

- 用户用 `/rheostat [<0..1>]` 命令滑动（裸 `/rheostat` 读取）。
- 模型用 `rheostat_set` 工具滑动、`rheostat_get` 工具读取。
- 每次请求渲染一个 `rheostat:style` 提示片段，描述当前位置及其风格指令。
- 位置是持久的会话状态（`rheostat/position` 会话事件，最后一次写入生效，默认 0.5），恢复与派生（fork）都能还原。

## 别人怎么安装

包尚未发布到 npm registry，请直接从本仓库安装。**在 pnpm workspace 之外运行**（npm 不支持 `workspace:` 协议）：

```sh
mkdir my-dsh-project && cd my-dsh-project
npm init -y
npm install github:JohnDoe0827/rheostat
```

安装时会自动构建（`prepare` 执行 `tsc`）。然后在 `cordis.yml` 中挂载：

```yaml
- name: '@deepseek-ai/dsh-rheostat'
```

插件注入 `tools` 与 `systemPrompt`；组合了 `commands` 服务时 `/rheostat` 命令生效。

> **在用 DeepSeek Harness 单仓库？** 插件已内置在 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) 的 `packages/context/rheostat`（等待上游合并），默认挂载在基础组合包中，无需安装。若在 pnpm workspace 中，请用 `pnpm add github:JohnDoe0827/rheostat` 而不是 npm。

## 用法

| 控制 | 效果 |
| --- | --- |
| `/rheostat` | 读取当前位置 |
| `/rheostat 0` | 切换到 0 模式（极简静默） |
| `/rheostat 1` | 切换到 1 模式（饱满热烈） |
| `/rheostat 0.7` | 混合，偏向饱满 |
| `rheostat_set(position)` | 模型滑动变阻器（0..1） |
| `rheostat_get()` | 模型以编程方式读取 |

模式区间：位置 ≤ 0.25 渲染 0 模式 · 极简静默；位置 ≥ 0.75 渲染 1 模式 · 饱满热烈；中间渲染 0 与 1 之间 · 均衡。

## 开发

```sh
npm install
npm run build   # tsc → lib/
npm test        # vitest：单元 + invariant + 真实 Loader 组合 + 全循环 mock 模型
```

## 发布到 npm（维护者）

有了拥有 `@deepseek-ai` scope 权限的 npm 账号后：

```sh
npm login
npm publish
```

发布后 `npm install @deepseek-ai/dsh-rheostat` 即可在任何地方使用。合并进 `deepseek-ai/deepseek-harness` 的上游进度见 `feat/dsh-rheostat` 的 pull request。
