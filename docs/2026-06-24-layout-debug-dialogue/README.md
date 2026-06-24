# 2026-06-24 家族谱系图自动排版问题对话与修改记录

记录时间：2026-06-24 02:46

本文档用于后续重新分析今天围绕 5.0/5.1 自动排版规则的讨论、失败案例、修改思路和最终遗留问题。它不是修复方案，而是把今天的判断过程和产生的问题完整留档。

## 相关图片

图片已复制到本文档同目录：

1. `01-original-II3-spouse-origin-error.png`：最初的错误案例，真实关系为 II-1、II-2、II-4 属于 I-1/I-2；II-3 是右侧 I-3/I-4 的子女并且是 II-2 的配偶。
2. `02-user-reference-analysis.png`：用户提供的参考分析，指出问题是谱系拓扑结构错误，不是文字标签错误。
3. `04-added-sibling-collapse.png`：给先证者再添加兄弟姐妹后，自动排版和关系避让崩溃的截图。
4. `05-bad-dogleg-route.png`：错误地把右侧父母下降线从外侧绕行，破坏 I-3/I-4 与其子女的小家庭关系。
5. `06-right-origin-dogleg-no-children.png`：右侧 I-3/I-4 到 II-5 出现折线的例子。
6. `07-right-origin-dogleg-with-child.png`：有子女结构时右侧来源家庭仍出现折线的例子。
7. `08-uneven-generation-II-spacing.png`：二代成员横向间距不规律的截图。
8. `09-II5-II6-II7-unequal-spacing.png`：II-5/II-6 与 II-6/II-7 间距不等，用户要求同一同胞横线上的同胞间距应均等。
9. `10-spouse-overlap-after-adding-partner.png`：给 II-4 添加配偶后，II-4 的配偶与后续同胞区域重叠。
10. `11-final-layout-failure.png`：最终失败截图，II-4/II-5 小家庭连线、右侧 I-3/I-4/II-8 血亲小家庭与二代同胞线仍存在冲突。
11. `12-generated-regression-after.png`：我生成的回归截图之一，后续又暴露了新的副作用。

## 初始问题

用户最初指出：2 代中 II-1、II-2、II-4 是 I-1/I-2 的子女，只有 II-3 配偶是右侧 I-3/I-4 所生。当前图把右侧父母下降线接到了左侧同胞横线上，容易误读为：

- II-3 也是左侧同胞组成员；
- II-4 是右侧父母子女；
- 两对父母共同连接到同一组二代子女。

用户强调的核心规则是：

- 同一条同胞横线只能表示同一对父母的子女。
- 配偶来源家庭不能混入另一方同胞横线。
- 婚姻/伴侣线必须连接双方人物符号，不能单独悬空。
- 父母到子女的关系应优先保持小家庭内部结构正确。
- 冲突处理应该先思考关系组空间占用，再排布，再画线。

## 参考思路

用户选择的方向不是“跨线但不连接”的图形处理，而是：

- 面对这种冲突，优先保证小家庭内部关系。
- 允许同一代人处在不同水平线上。
- 如果要下移，不是只下移婚姻线，而是把夫妻双方、婚姻线和共同子女作为核心小家庭整体下移。
- 线段长短可以变化，但关键锚点不能变成折线。

这套思路后来被进一步明确为：

- 小关系组内部连线关系先于关系组之间避让。
- 小关系组之间不应只靠绝对坐标决定，而应有相对位置约束。
- 父母婚配中心和子女本人应保持在同一条垂直线上。
- 可以把小组内部关系视为弹簧，长度可变，但关键节点不能变成折线。

## 今日修改思路与执行过程

### 1. 从 5.0 基础上升级为 5.1

我把版本号改为 5.1，并新增了一批关系组冲突检测函数。

目标：

- 检测父母-子女组、同胞组、夫妻/生育组之间的空间占用冲突。
- 遇到配偶来源家庭与另一方同胞横线冲突时，把核心小家庭整体下移。
- 尽量避免把配偶来源父母下降线接入错误的同胞横线。

涉及文件：

- `家族谱系图工具/app.js`
- `家族谱系图工具/index.html`
- `家族谱系图工具/使用说明.md`
- `README.md`
- `CHANGELOG.md`

### 2. 错误尝试：父母下降线路由

我最初实现了 `layoutParentRoutes` 和 `drawRoutedSingleChildParentLine()`，让右侧父母下降线绕过左侧同胞横线。

用户指出这是错误方向：

- 这只是把父母亲的垂直线从外面绕了一圈。
- 右侧 I-3/I-4 和其子女的小家庭关系没有保持。
- 应该先解决空间占用和排布，而不是在连线层绕线。

随后我删除了这一路由思路。

相关图片：

![bad dogleg](./05-bad-dogleg-route.png)

### 3. 改为移动冲突家庭块

我随后改成：

- 先检测同胞线和另一来源家庭下降线的空间冲突。
- 将配偶来源血亲家庭块移到同胞横线占用区之外。
- 再把核心夫妻小家庭整体下移。
- 最后用标准亲子线、同胞线、婚姻线绘制。

这个方向比绕线更接近用户要求，但后续仍然出现多个副作用。

### 4. 小家庭内部锚点复核

用户指出右侧 I-3/I-4 到 II-5 仍出现折线。

我分析后发现：

- 父母婚配中心 `dropX` 和独生子女 x 坐标不一致。
- 渲染层 `drawSiblingConnector()` 为了连通单子女，自动补了一段水平线。

因此我新增了 `enforceInternalRelationAnchors()`：

- 对双亲独生子女家庭，强制父母婚配中心与子女本人共垂线。
- 这使右侧血亲家庭不再靠横向补线表达。

但这个后处理后来与同胞等距、小家庭占位推开互相冲突。

相关图片：

![right origin dogleg](./06-right-origin-dogleg-no-children.png)

### 5. 同胞横向间距问题

用户指出二代横向间距不规律，尤其是前面几个同胞之间的间距和后面不一致。

我先解释为：

- 原本存在“大同胞组每 3 人额外加距”的规则。
- 还有“夫妻超级节点宽度”影响同胞锚点间距。

用户指出：

- 同胞之间应平等。
- 夫妻块本身不是稳定标准，不能拿派生布局块作为同胞间距依据。

随后我删除了大同胞每 3 人加距规则，并把同胞锚点改为等距。

### 6. 错误修正：等距过硬

我一度把“同胞锚点等距”做成最终硬约束。

用户随后指出：

- II-5/II-6 与 II-6/II-7 间距仍不一致。
- 同一条横线上的同胞之间，锚点应该等距。

我进一步加了最终坐标层的同胞锚点等距复核。

但这个修改又导致新的问题：

- 如果 II-4 已经有配偶和子女，这个小家庭占位应该优先。
- 同胞锚点等距不能压过配偶线、子代结构和小家庭不重叠。

相关图片：

![unequal spacing](./09-II5-II6-II7-unequal-spacing.png)

### 7. 添加配偶后重叠

用户给 II-4 添加配偶后，II-4 的配偶和原有 II-5/后续同胞区域重叠。

用户指出：

- 这里不是简单等距问题。
- II-4 有了配偶和子代后，II-4 与哥哥、弟弟之间的横向关系就不能继续强行等距。
- 同胞等距必须为小家庭占位让步。

我随后把最终复核改成：

- 先给同胞锚点一个等距目标。
- 再计算每个同胞的小家庭占位，包括本人、配偶、共同子代。
- 如果占位冲突，就局部放大相邻同胞间距。

这个思路是合理的，但当前实现仍然没有收敛成稳定布局，见最终失败图。

相关图片：

![spouse overlap](./10-spouse-overlap-after-adding-partner.png)

### 8. 拖动重排失效

用户指出拖动重排效果没有了。

我最初误判为“添加兄弟/姐妹默认顺序”问题，这是不准确的。后面重新检查，问题在于：

- `reorderByX()` 拖动后会更新顺序；
- 但 `autoLayout()` 的重心排序没有把同胞组顺序作为硬约束；
- 后续父子重心、配偶偏置、避让又会把拖动顺序覆盖掉。

我修改为：

- 拖动重排优先只重排当前同父母同胞组；
- 自动排版排序阶段加入 `siblingOrderComparator()`，把同胞顺序作为硬约束。

但由于后续规则越来越多，这仍然不是完整解决。

## 当前最终失败点

最终截图显示，今天的多轮补丁叠加后，自动排版仍然失败：

![final failure](./11-final-layout-failure.png)

主要问题包括：

1. II-4 和 II-5 的小家庭关系线出现不自然连接。
2. I-3/I-4/II-8 的右侧血亲小家庭与二代同胞横线仍然发生空间冲突。
3. 左侧同胞线和右侧来源家庭线再次产生视觉重叠。
4. 同胞等距、小家庭占位、核心小家庭下移、血亲来源家庭垂直锚点之间没有统一约束求解，只是在不断追加后处理。

用户判断：今天的修改已经没有意义。

这个判断是合理的。当前实现进入了“补丁叠补丁”的状态：每修一个局部问题，另一个关系组约束被破坏。

## 今日暴露出的根本问题

### 1. 自动排版没有明确约束优先级

今天不断摇摆的规则包括：

- 同胞锚点等距；
- 小家庭内部配偶/子代不重叠；
- 父母婚配中心与子女共垂线；
- 配偶来源家庭不能接入另一方同胞线；
- 核心小家庭整体下移；
- 允许同代不同水平；
- 拖动重排顺序应保留。

这些约束之间有优先级，但当前代码没有统一建模。

### 2. 关系组被当成后处理，而不是布局基本单位

当前流程大致是：

1. 夫妻超级节点做重心排布；
2. 同胞顺序修正；
3. 父母子女锚点修正；
4. 重叠修正；
5. 写回坐标；
6. 关系组冲突修正；
7. 最终同胞锚点修正；
8. 内部关系锚点修正。

这些步骤互相覆盖，没有全局求解。

### 3. “线”仍然在替布局兜底

虽然删除了显式绕线函数，但渲染层仍然存在：

- 单子女偏移时补水平线；
- 配偶不同高时台阶线；
- 同胞线被 blockers 分段；
- 横线范围由最终坐标临时决定。

这使得布局错误有时被线条兜底，有时又暴露为误读。

### 4. 同胞等距不是无条件硬约束

今天的对话实际得出更细的规则：

- 同一条同胞横线上的同胞锚点默认应等距。
- 但如果某个同胞已经形成配偶/子代小家庭，小家庭内部不重叠、配偶线合理、子代线合理应优先。
- 因此同胞等距应是基础目标，而不是绝对硬约束。

### 5. 当前 5.1 补丁不应继续叠加

继续在现在这套流程上补，会继续出现：

- 修复右侧来源家庭，破坏同胞等距；
- 修复同胞等距，破坏已婚小家庭；
- 修复已婚小家庭，破坏来源家庭垂直锚点；
- 修复拖动顺序，重心排序或冲突避让又覆盖。

## 建议后续重新设计方向

### 1. 先定义关系组层级

建议至少有这些布局实体：

- Person：单个人符号。
- Couple：配偶对，负责婚姻线和双方相对位置。
- NuclearFamily：父母/伴侣 + 子女集合。
- SiblingGroup：同一对父母的子女锚点序列。
- DescendantFamily：某个已婚子女与其配偶和子代形成的小家庭。
- OriginFamily：配偶来源父母和其血缘子女。

### 2. 先做组内约束，再做组间排布

组内硬约束：

- 配偶线连接双方符号。
- 双亲独生子女：父母婚配中心与子女本人共垂线。
- 多子女：父母下降线接到同胞横线，子女锚点在同胞横线上。
- 同一小家庭内部不得出现人物符号重叠。

组间软约束：

- 同代尽量同水平。
- 同胞锚点尽量等距。
- 小家庭之间尽量紧凑。
- 线条尽量短。

组间硬约束：

- 不同父母的同胞横线不能共享节点。
- 配偶来源家庭不能被接入另一方同胞横线。
- 不能通过折线伪造血亲关系。

### 3. 不要把“同代排序”和“避让”混在一个步骤

建议改为：

1. 根据亲缘关系建立拓扑图。
2. 为每个小关系组计算最小占位盒。
3. 在同胞序列中放置每个子女锚点和其小家庭占位盒。
4. 检测占位盒重叠，必要时扩大同胞间距。
5. 放置配偶来源家庭，使其与核心小家庭和同胞组不冲突。
6. 最后根据已确定坐标画线。

### 4. 拖动重排应修改关系顺序，不应直接修改最终坐标

拖动同胞到新位置时，应更新该同胞组的顺序字段，例如 `siblingOrder`，而不是全局 `person.order`。全局 order 同时承担创建顺序、配偶排序、同代排序，会互相污染。

## 当前代码状态

截至本文档创建时，工作区存在未提交修改：

- `CHANGELOG.md`
- `README.md`
- `家族谱系图工具/app.js`
- `家族谱系图工具/index.html`
- `家族谱系图工具/使用说明.md`

这些修改包括今天所有 5.1 尝试性补丁。它们目前不能视为稳定修复。

已做过的检查：

- 多次执行 `node --check 家族谱系图工具/app.js`
- 多次执行全量 JS `node --check`
- 多次用本地 HTTP server + Chrome headless 导出回归图

但最终截图已经证明：当前规则组合仍未正确。

## 建议给后续分析者的结论

不要继续把今天的 5.1 补丁作为稳定基础直接扩展。

更可行的做法是：

1. 保留 5.0 的显式数据模型作为基础。
2. 抽离今天讨论出的约束优先级。
3. 重新实现一个以“关系组占位盒”为核心的布局求解器。
4. 渲染层只按最终布局画标准线，不再承担避让和补线职责。

今天的主要价值不是代码改动，而是明确了这些约束的冲突关系和优先级。

## 后续重构执行记录

### STEP 1 - 建立新的工程分层结构

本步骤的目的是建立新的工程分层架构，为后续谱系图引擎重构提供基础目录结构。

已在项目根目录下创建 `src/` 分层目录：

- `src/model`
- `src/layout`
- `src/render`
- `src/rules`
- `src/core`

该结构将系统明确划分为数据模型层（model）、布局计算层（layout）、渲染层（render）、规则层（rules）与核心调度层（core），以避免当前代码中“布局与渲染耦合”的问题进一步扩大。

本步骤未修改现有运行代码。

### STEP 15 - 替换旧入口

本步骤完成新 TypeScript 架构入口迁移，将新的输出路径统一到 `buildPedigree(graph)`。

当前项目中未发现 `index.ts` / `main.ts` / `app.ts` 入口文件；现有可运行页面入口仍是旧浏览器版 `家族谱系图工具/app.js`。

因此本步骤已创建 `src/index.ts` 作为新 pedigree engine 的统一入口：

- 引入 `buildPedigree` from `./core/engine`
- 导出 `buildPedigree`
- 提供 `renderPedigree(graph)`，内部唯一调用 `buildPedigree(graph)`
- 默认导出 `buildPedigree`

新架构的输出路径已统一为：

```text
PedigreeGraph -> buildPedigree(graph) -> SVG string
```

现有浏览器 UI 尚未迁移到该 TypeScript 入口；旧 `家族谱系图工具/app.js` 暂保留为兼容运行壳，避免当前页面在迁移中直接失效。

### STEP 16 - 清理旧 tree layout 逻辑

本步骤清理遗留 tree-based layout 逻辑。

已在 `家族谱系图工具/app.js` 中移除旧 `family-forest tidy tree` 自动排版主体，包括：

- 夫妻超级节点排布
- 父代 / 子代重心迭代排序
- 同胞出生顺序后处理
- 单亲独生子女专用对齐
- 节点重叠右推
- 旧自动排版中的 `x/y` 坐标写回
- 旧坐标归一化中的 `x/y` 批量改写

`autoLayout()` 当前保留为 legacy 兼容入口，仅同步 generation、运行时 family unit 视图和编号，不再执行 tree layout，也不再直接分配坐标。

保留的 `x/y` 写入仅用于手动拖动和加载既有布局坐标，不属于渲染层坐标分配。

旧系统基于树结构假设，无法支持双亲遗传结构，因此必须移除以避免与新 graph model 冲突。

### STEP 17 - 验收检查代码注释

本步骤增加系统验收标准注释，用于确保后续开发过程中不破坏架构约束。

已在 `src/core/engine.ts` 中加入 architecture checks：

- No person-person edges exist.
- All relationships use UnionNode.
- Layout is independent from rendering.
- Rendering contains no graph logic.

该检查作为“轻量架构防护层”，用于防止 layout/render 再次耦合。

### STEP 14 - Core Engine 统一入口

本步骤构建系统统一入口 `engine`，将数据验证、布局计算与渲染流程串联为标准 pipeline。

已创建 `src/core/engine.ts`，定义 `buildPedigree(graph)`：

- `validateGraph(graph)`
- `computeLayout(g1)`
- `render(g2)`

该设计实现“数据 -> 布局 -> 渲染”的单向数据流结构，避免逻辑耦合。

本步骤未修改现有运行代码。

### STEP 13 - Validation 层

本步骤引入数据验证层，用于检测谱系结构合法性。

已创建 `src/rules/validation.ts`，定义 `validateGraph(graph)`：

- 输入 `PedigreeGraph`
- 当前占位实现直接返回 `graph`

未来将用于检测 orphan node、循环结构及缺失婚配关系等问题。

本步骤未修改现有运行代码。

### STEP 12 - 基础节点渲染

本步骤实现基础节点渲染能力，用于验证 layout -> render 数据流是否正确。

已更新 `src/render/svgRenderer.ts`：

- 初始化 `nodes` 字符串
- 遍历 `graph.persons.values()`
- 为每个个体输出一个占位圆形节点
- 返回包含节点的 SVG 字符串

当前仅为占位渲染，后续将根据 `sex` / `affected` 状态映射不同图形符号。

本步骤未修改现有运行代码。

### STEP 11 - SVG 渲染器骨架

本步骤引入渲染层接口，将布局结果转换为 SVG 输出。

已创建 `src/render/svgRenderer.ts`，定义 `render(graph)`：

- 输入 `PedigreeGraph`
- 当前返回最小 SVG 字符串：`<svg></svg>`

当前为最小可运行结构，用于验证 pipeline 输出链路完整性。

本步骤未修改现有运行代码。

### STEP 10 - Layout Pipeline 整合

本步骤正式建立完整 layout pipeline。

已更新 `src/layout/computeLayout.ts`，将布局计算拆分为三个阶段：

- 分层（layering）：`assignLayers`
- 交叉优化（crossing reduction）：`reduceCrossings`
- 坐标分配（coordinate assignment）：`assignCoordinates`

`computeLayout(graph)` 现在按顺序执行上述三个阶段，并返回处理后的 `PedigreeGraph`。

该结构为标准 layered graph drawing pipeline，是谱系图布局的基础架构。

本步骤未修改现有运行代码。

### STEP 9 - 坐标分配器

本步骤实现基础坐标分配逻辑，用于确定节点横向排列顺序。

已创建 `src/layout/coordinateSolver.ts`，定义 `assignCoordinates(graph)`：

- 从 `x = 0` 开始线性递增
- 遍历 `graph.persons`
- 对未设置 `birthOrder` 的个体依次赋值
- 返回原 `graph`

当前采用简单线性分配策略，后续将替换为基于 sibling ordering + subtree width balancing 的优化算法。

本步骤未修改现有运行代码。

### STEP 8 - Crossing Reducer 占位

本步骤引入 crossing reduction 模块接口，用于后续解决谱系图中常见的边交叉问题。

已创建 `src/layout/crossingReducer.ts`，定义 `reduceCrossings(graph)`：

- 输入 `PedigreeGraph`
- 当前占位实现直接返回 `graph`

当前仅作为结构占位，后续将引入 barycenter heuristic 等算法进行优化。

本步骤未修改现有运行代码。

### STEP 7 - Generation 分层 Layer Assignment

本步骤引入 generation-based layering 模型。

已创建 `src/layout/layerAssigner.ts`，定义 `assignLayers(graph)`：

- 遍历 `graph.persons`
- 对未设置 `generation` 的个体默认赋值为 `0`
- 返回原 `graph`

谱系图本质为分层图结构（layered graph），`generation` 对应 y-axis 层级。

当前实现为基础版本，后续将基于父子关系递归推导 generation。

本步骤未修改现有运行代码。

### STEP 5 - 移除 person-person edge 模型

本步骤进行核心数据结构迁移，将系统从“树结构模型”转换为“谱系图模型”。

已完成的代码调整：

- 删除 `app.js` 中旧的 `addRelationship()` 入口。
- 删除 `partnerRelations()` 与 `parentChildRelations()` 这类运行时 person-person edge 视图。
- 婚配绘制、婚配节点计算与代际计算改为直接遍历 `unions`。
- 亲子来源查询、代际计算、家族史亲缘遍历改为通过 `parentage.unionId -> union.partnerIds` 取得父母来源。
- 校验器新增约束：`parentage.parentIds` 必须与对应 `Union` 的 `partnerIds` 一致，禁止亲子关系绕过 Union。
- 旧树结构 JSON 不再在核心迁移器内直接推导为谱系图；旧数据需要先由独立转换器转换为 schemaVersion 2。

所有 person-to-person edge 被移除，婚配关系统一抽象为 `UnionNode` / `Union`。

该修改解决了传统 family tree 中无法表达双亲结构的问题，使数据模型符合医学遗传谱系标准。

### STEP 6 - 初始化 Layout Pipeline

本步骤建立布局计算入口函数 `computeLayout`。

已创建 `src/layout/computeLayout.ts`：

- 输入 `PedigreeGraph`
- 当前 stub 版本直接返回 `graph`

当前实现为 stub 版本，用于先固定 pipeline 结构，后续逐步引入 layering、crossing reduction 与 coordinate assignment。

目的是确保 layout pipeline 结构先于算法细节稳定下来。

本步骤未修改现有运行代码。

### STEP 4 - 构建 PedigreeGraph 数据结构

本步骤定义完整谱系图数据结构 `PedigreeGraph`。

已创建 `src/model/pedigreeGraph.ts`，定义：

- `persons: Map<string, Person>`
- `unions: Map<string, UnionNode>`
- `childrenMap: Map<string, string[]>`

该结构采用“人 + 婚配单元 + 子代映射”的三元模型，以支持标准医学 pedigree graph 的 bipartite 结构表达。

相比原始 tree structure，该模型允许一个子节点拥有双亲来源，并消除树结构的单亲限制。

本步骤未修改现有运行代码。

### STEP 3 - 引入 UnionNode 婚配关系抽象

本步骤引入 `UnionNode`，用于抽象“婚配关系”。

已创建 `src/model/union.ts`，定义：

- `UnionNode.id`
- `UnionNode.partners`

在传统实现中，婚配关系通常被错误建模为 person-to-person edge，但在遗传谱系图中，婚配本质是一个独立的结构节点（union event）。

该改造将关系从“边”提升为“节点”，以支持更复杂的遗传结构表达。

本步骤未修改现有运行代码。

### STEP 2 - 引入 Person 语义模型

本步骤引入统一的个体语义模型 `Person`，用于替代当前系统中分散的节点结构。

已创建 `src/model/person.ts`，定义：

- `Sex`：`"M"`、`"F"`、`"U"`
- `Person.id`
- `Person.sex`
- `Person.affected`
- `Person.carrier`
- `Person.generation`
- `Person.birthOrder`

该模型明确区分性别、疾病状态及遗传特征，并保留生成层级与出生顺序字段，为后续谱系布局提供结构基础。

此设计的核心目的是将“图形节点”提升为“医学语义对象”。

本步骤未修改现有运行代码。
