# dsh-rheostat（滑动变阻器）

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的会话风格变阻器：一个 [0, 1] 之间的位置，在 **0 模式**（极简、安静、克制）与 **1 模式**（饱满、生动、详细）之间滑动切换模型的回答风格，中间位置按比例混合。

- 用户用 `/rheostat [<0..1>]` 命令滑动（裸 `/rheostat` 读取）。
- 模型用 `rheostat_set` 工具滑动、`rheostat_get` 工具读取。
- 每次请求渲染一个 `rheostat:style` 提示片段，描述当前位置及其风格指令。
- 位置是持久的会话状态（`rheostat/position` 会话事件，最后一次写入生效，默认 0.5），恢复与派生（fork）都能还原。

## 安装

```sh
npm install @deepseek-ai/dsh-rheostat
```

在 `cordis.yml` 中挂载：

```yaml
- name: '@deepseek-ai/dsh-rheostat'
```

插件注入 `tools` 与 `systemPrompt`；组合了 `commands` 服务时 `/rheostat` 命令生效。

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

## 发布到 npm

需要拥有 `@deepseek-ai` scope 权限的 npm 账号（或改用自己的 scope 重新发布）：

```sh
npm login
npm publish
```

## 属于 DeepSeek Harness 单仓库

本包随 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 一起发布，位于 `packages/context/rheostat`，默认挂载在基础组合包中。本仓库是供直接使用与贡献的独立镜像。
