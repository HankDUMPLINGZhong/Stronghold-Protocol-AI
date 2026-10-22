# 统一测评集 enemy-diversity-v1

| 文件 | 内容 |
|---|---|
| [enemy-diversity-v1.json](enemy-diversity-v1.json) | 两档共56个固定场景，包含种子、地图、关底Boss、中途敌人类别及预抽取记录 |
| [cases.csv](cases.csv) | 场景索引，便于在GitHub直接查看 |
| [policies.json](policies.json) | 两位精英干员与各自原版同开局对照的配置 |
| [results.json](results.json) | 两位精英干员与各自原版的224局结果、逐局摘要与统计 |
| [coop-abyss-diversity-v1.json](coop-abyss-diversity-v1.json) | 多人终极固定56场景，二人和四人复用同一测试集 |
| [arturia-v0.2.3-multiplayer.md](arturia-v0.2.3-multiplayer.md) | 图图多人发行表：二人、四人各一行，只列包含图图的队伍 |
| [arturia-v0.2.3-multiplayer.json](arturia-v0.2.3-multiplayer.json) | 112局多人原始指标及可重算汇总，不包含全原版对照成绩 |

从20001–30000共10000个种子预生成敌人环境，按7种关底Boss、7张地图和中间敌人覆盖均衡选出28种场景，每难度分别运行。**选种不读取AI胜负**；关闭随机盟约禁用，公开已发布两位精英干员与各自原版的同开局对照。

```powershell
node tools/verify-benchmarks.mjs
```

该命令检查场景／种子／类别覆盖、测试集哈希、对照完整性与成绩，不运行游戏战斗。生成器和完整评测仍在原项目`dev`分支维护；日后策略闭环后同步此数据与README。

本测评集为固定单人均衡诊断集，不代表多人房或自然开局胜率，也不是未见留出集。成绩见[仓库README](../README.md)，指标口径见[说明](../docs/strategies/benchmark.md)。

多人数据另用`coop-abyss-diversity-v1`，同样先按环境选种、冻结后运行。发行表的平均到达回合取队伍最高进入回合（含失败当轮）；拉特兰层数、漏怪和兜怪只取图图本人，按全部对局平均，提前淘汰不剔除。层数取结束／淘汰前的生效值；漏怪为自家普通波联防前计数；兜怪为联防中归属图图及其召唤物的计数敌人击杀。多人结果也不等于自然随机开局胜率。
