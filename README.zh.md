# @deepseek-ai/dsh-rheostat

[English](README.md) | 中文

滑动变阻器（style dial）：每个会话一个 [0, 1] 之间的位置，在 0 模式（极简静默）与 1 模式（饱满热烈）之间滑动，切换模型的回答风格。

## What it does

变阻器是一个 [0, 1] 之间的数字，默认位于中性中点 0.5。每次请求组装都会渲染一个 `rheostat:style` 提示片段（prompt section），描述当前位置及其模式区间的风格指令：

- 位置 ≤ 0.25 — 0 模式 · 极简静默：回答极简，先给结论，不要铺垫。
- 位置 ≥ 0.75 — 1 模式 · 饱满热烈：回答饱满、详细、有表现力。
- 中间位置 — 0 与 1 之间 · 均衡：两种风格按比例混合，靠近 0 更克制，靠近 1 更热烈。

位置以 `rheostat/position` 会话事件落盘（整值替换，最后一次写入生效），因此恢复与派生（fork）都能还原它，无需实时镜像。任何人都可以滑动它：

- 模型调用 `rheostat_set(position)` 滑动、`rheostat_get()` 读取（提示片段本身已声明位置，get 工具是给程序化消费者用的）；
- 用户运行 `/rheostat [<0..1>]` 命令（裸 `/rheostat` 读取位置）。

## 同一提示词，不同阻值

同一提示词（「你喜欢花生吗」），三个阻值下的回答（录自真实会话，完整原文）：

| 阻值 | 模式 | 回答 |
| --- | --- | --- |
| `0.00` | 0 模式 · 极简静默 | 喜欢。 |
| `0.50` | 0 与 1 之间 · 均衡 | 喜欢。花生这东西朴素又实在：脆、香、耐嚼，生的脆、煮的糯、炸的酥，几种做法各有各的好。下酒有油炸花生米，煲汤有花生猪脚，磨成酱还能抹面包。许地山那篇《落花生》也写得好——土里刨出来灰扑扑的，却是好东西，踏实。<br><br>要说缺点，就是油炸的容易吃多，过敏的人碰不得，其他没毛病。你呢，平时怎么吃花生比较多？ |
| `1.00` | 1 模式 · 饱满热烈 | 哈哈，喜欢！而且不是一般的喜欢——花生在我这儿简直是"食材界的六边形战士"，必须好好夸一夸！🥜<br><br>**先说口感**：生花生脆、煮花生糯、炸花生酥、烤花生香，一颗小小的豆子（严格说是豆科植物的种子）能玩出四种完全不同的质感，这还不够神奇吗？<br><br>**再说味道**：花生那股油脂香配上微微的甜，是那种"越嚼越上头"的香。不管是：深夜大排档那盘撒了盐粒的**油炸花生米**，配啤酒绝了；四川人涮火锅前先垫肚的**醋泡花生**，酸香开胃；老北京那碗咸香浓郁的**面茶**，顶上撒的就是花生碎；南方人煲汤时的**花生猪脚汤**，炖到酥烂入口即化。<br><br>**还有情怀加成**：鲁迅先生都说"落花生"——许地山那篇课文《落花生》可是刻进几代人 DNA 的："人要做有用的人，不要做只讲体面的人。" 一粒花生，从土里刨出来时灰扑扑的，却是实打实的好东西，多有人格魅力啊！<br><br>**甚至连"被黑"都黑得可爱**：有人说吃花生会胖——拜托，那是油炸和糖裹的锅，纯花生反而是优质脂肪和蛋白质的来源，健身的人还专门吃花生酱呢。唯一的遗憾是过敏人群要远离，这个我们得温柔地尊重。<br><br>所以结论：**喜欢，非常喜欢**。要是在一个下雨天的傍晚，桌上有一碟刚炒好的花生米、一壶热茶，那这个夜晚就已经赢了大半。🌰✨<br><br>你呢？你更喜欢花生的哪种吃法？油炸、水煮、还是磨成酱抹面包？ |

## The sliding boundary

模型滑动在工具执行期间直接追加 `rheostat/position` 事件。用户在回合之间发起的 `/rheostat` 选择也会立即追加并注入一条简短通知；在回合进行中发起的选择会先挂起（pending），直到下一个被接受的回合内 pre-step 将其落盘并把变更叙述进该次请求——这与 plan-mode 使用的边界相同，因为回合进行中从任意命令处理器调用 `Session.append` 不是受支持的发布点。挂起的选择对紧随其后的提示组装立即可见（片段在落盘前就读取它），因此风格切换不会因边界而延迟。

## Configuration

无。默认位置（0.5）与风格文本属于产品定义，不是部署选项。

## The prompt section

`rheostat:style` 以 order 40 注册——位于部署人格（0）之后、plan-mode 指导（50）之前，这样在计划评审期间 plan-mode 规则仍可覆盖变阻器。组装没有 agent 时该片段为空。

## Export shape

函数/命名空间插件：导出 `name` / `inject` / `apply`，没有 default 导出。多余的 `export default` 会让 Loader 的 `unwrapExports` 折叠模块并丢掉 `inject`（见 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。

## Model Experience

### Prompt section

#### What the model sees

每个携带 agent 的请求都有一个该片段，由折叠（或挂起）的位置按会话语言渲染：`detectLanguage` 根据最近一条用户消息分类（中文字符占优→中文，拉丁字符占优→英文），尚无用户消息时默认中文。三个区间的逐字正文在 [src/index.ts](src/index.ts) 的 `styleText` 中：极简 0 区、均衡中间区、饱满 1 区分别替换下面模板中的 `{position}` 与 `{mode label}` 占位符，并追加各自的指导句。

##### Verbatim template（中文）

```markdown
滑动变阻器（style dial）位于 {position}，处于 {mode label}。
{band guidance}
用户可以用 /rheostat <0..1> 滑动它，你也可以调用 rheostat_set 工具。
```

##### Verbatim template（英文）

```markdown
The style dial (滑动变阻器) is at {position} — {mode label}.
{band guidance}
The user can slide it with /rheostat <0..1>, and you can call the rheostat_set tool.
```

##### Rendered example at position 0.00

```markdown
滑动变阻器（style dial）位于 0.00，处于 0 模式 · 极简静默。 调整回答风格：只给结论，不给铺垫；能用一句话绝不用两句；删掉寒暄、修饰与重复；列表尽量短。 像 0 一样安静、克制、留白。用户可以用 /rheostat <0..1> 滑动它，你也可以调用 rheostat_set 工具。
```

##### Rendered English example at position 1.00

```markdown
The style dial (滑动变阻器) is at 1.00 — 1 mode · Expressive & Lively. Adjust your response style: expand freely; add background, detail, and examples unprompted; be warm and present; enthusiasm, emphasis, and rhythm are welcome; light up every thought and never go missing. Be as bright, loud, and rich as 1. The user can slide it with /rheostat <0..1>, and you can call the rheostat_set tool.
```

#### Token effect

每个携带 agent 的请求都有固定的小开销（一个约 120 字符的片段）；位置只改变插值的数字，不改变结构。

#### KV Cache effect

在片段注册与位置不变时前缀稳定。一次滑动会追加新的 `rheostat/position` 事件，改变片段插值文本，使新位置首次渲染点之后的复用失效。滑动之间片段逐字节一致，不会使复用失效。

### Tool schema

#### What the model sees

生成的 [`rheostat_set` 与 `rheostat_get` schema](../../../docs/tool-catalog.md#deepseek-aidsh-rheostat)。

#### Token effect

工具可见的每个请求都有固定的 schema 开销。

#### KV Cache effect

定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使这些 schema 的复用失效。

### Tool-call history and result

#### What the model sees

`rheostat_set` 精确返回 `{ position, mode }`，`mode` 为 `terse` / `balanced` / `expressive` 之一，渲染为 `Style dial slid to <position> — <mode label>.`；`rheostat_get` 返回同样的值，渲染为 `Style dial at <position> — <mode label>.` 稳定的失败信息为 `Error: rheostat_set requires an owning agent session`、`Error: rheostat_get requires an owning agent session`、`Error: rheostat position must be between 0 and 1, got <n>`（或 `Error: rheostat position must be a finite number, got <value>`）。`/rheostat` 滑动还会追加一条 `user/message` 通知（`The user slid the style dial (滑动变阻器) to <position> (<mode label>).`），下一次请求会把它当作插件来源的上下文看到。

#### Token effect

每次调用增长固定形状，与变阻器历史无关；`rheostat/position` 事件本身是 UI/回放状态，不是第二条模型消息。

#### KV Cache effect

只追加；新出现的内容跟在可复用请求前缀之后，不会使既有 KV 缓存条目失效。

## Known Limitations and Deferred Work

- **仅限单个会话** — 变阻器属于设置它的那个 agent 会话；没有跨会话的共享/全局变阻器，非 agent 调用方会被拒绝。
- **风格是指引而非强制** — 片段只是指示模型的风格，模型仍可能偏离；没有后处理来强制极简或饱满输出。
- **离散模式区间，连续位置** — 模式标签在 0.25/0.75 处切换，而位置保持连续；对指引本身做更细粒度插值的工作被推迟。
