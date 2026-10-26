# 贡献方式

本仓库用于发布AI策略插件、公开已发布版本源码和接收Issue／PR。日常开发、完整评测工具和详细经验继续保留在原项目的`dev`分支。

## 提交问题或PR

说明游戏版本、插件版本、复现步骤、预期和实际行为；附种子、难度或必要的脱敏错误信息。不要上传存档、令牌、个人安装备份或完整私人对话。

发行修复可针对`addons/arturia/`、`addons/lavinia/`或`addons/zumama/`提交PR；策略改进可附补丁与验证依据。一次PR处理一个问题，不更改游戏规则、原版AI或开局选择概率来获得优势。新策略尚未发布时不作为受支持策略加入仓库目录。

PR经审查后纳入原项目`dev`分支验证。确认改进后运行完整固定测试集，保留原版同开局对照，再同步发行源码、简明说明和最新成绩。公开仓库不维护详细复盘或开发笔记。

## 构建与验证发行包

扩展分支的条件安装适配及单独回归入口见[扩展宿主适配](docs/extended-host-compatibility.md)。三款的精确验证提交由compatibility.json分别登记；祖玛玛的共用安装和旧记录迁移见[安装说明](docs/installation.md)。

需要Node.js22+；打包ZIP另需Python3。构建无额外npm依赖：

```powershell
npm test
npm run build
python tools/package-release.py
python tools/package-release.py lavinia
python tools/package-release.py zumama
```

集成测试需要独立游戏Git检出，仅在临时目录归档和安装，不修改作为来源的游戏目录：

```powershell
git clone https://github.com/sganggs/Stronghold-Protocol.git .cache/upstream
$env:SP_GAME_REPO = (Resolve-Path .cache/upstream).Path
npm --prefix .cache/upstream ci
npm run test:integration
```

默认使用发行清单原本验证的宿主；复查其他提交时设置`ARTURIA_TEST_REF`及`LAVINIA_TEST_REFS`（后者可用逗号分隔）。例如两者均设为`b3deebdae4a92642c007d217a1a4573e5d3612c5`，可复现0.3.1集成测试，包含图图升级时自动保留拉维妮娅、回滚及中断恢复。归档直接写入临时文件，避免新版宿主超过标准输出缓冲区上限；不修改来源检出或正在运行的游戏。

另执行`npm run test:restart`可复现“先启动原版服务、再安装插件”时的新菜单／旧服务混用，并用全新进程验证重启后两位精英及固定开局恢复。此测试运行临时本机HTTP／WebSocket服务，不热更新用户正在玩的游戏。

已发布v0.1.0的策略源码与清单保持不可变，构建读取`catalog.json`登记的独立冻结快照。候选改进应与已发布快照分开，不能悄悄改变已有发行包。新版本在开发验证后新增快照和清单，再更新版本登记和构建入口。

三款插件独立使用语义版本号。Tag 分别为 `arturia-vX.Y.Z`、`lavinia-vX.Y.Z`、`zumama-vX.Y.Z`；发行标题分别为 `【拉特兰-潘格尼尼】阿尔图罗·vX.Y.Z`、`【贾维-叙拉古】拉维妮娅·vX.Y.Z`、`【萨尔贡-佩佩】祖玛玛·vX.Y.Z`。说明末尾只放本插件的分类标记 `addon-arturia`、`addon-lavinia` 或 `addon-zumama`，用于独立版本列表的筛选。新发行同时更新[分类下载索引](RELEASES.md)。

多人模式发行数据统一在一张表列两行：二人「对应 AI＋bot」、四人「对应 AI＋3bot」；不合并人数，不列全原版 bot 对照，单人数据另列。列固定为胜场/总场数、平均到达回合、本人有效核心平均层数、本人平均漏怪、本人平均兜怪。到达回合取队伍实际进入的最高回合（含失败当轮）；其余三项仅统计对应 AI 本人，按所有对局平均，提前淘汰不剔除。层数取本局结束／淘汰前仍生效的核心层数，漏怪取自家普通波联防前计数，兜怪取联防中归属本人及其召唤物的计数敌人击杀，不摊分队友和环境击杀。使用 `tools/release-multiplayer-report.mjs` 或对应具名报告工具生成表格，并保留人数、难度、固定测试集和逐局指标来源。后续多人发行沿用此口径。

仓库Latest标记指向图图最新正式发行；独立版本的下载索引和历史标签保持可用。

只改一款策略、安装器或运行适配器，就只升级该款；共用接入修复实际影响两款时，各自升级补丁版本并做共存验证。只更新宿主兼容验证、文档或发行标题时不升插件版本、不替换已有附件；已验证的宿主版本与提交单独记录在`compatibility.json`。仓库根`package.json`是构建工具包版本，不代表两款插件的统一发行号。

2026-10-19 经维护者要求将阿尔图罗旧`v0.1.x`发行标签迁移到`arturia-v0.1.x`，新旧标签指向相同 Git 对象，旧标签保留作源码别名；Release 与下载索引使用新标签。迁移不改变附件或策略源码。后续不移动已发布标签指向，也不覆盖同版本附件。

遵循GPL-3.0-or-later并保留来源说明。不上传游戏美术、音乐或语音；项目保持非商业同人性质。
