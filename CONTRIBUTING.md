# 贡献方式

本仓库用于发布AI策略插件、公开已发布版本源码和接收Issue／PR。日常开发、完整评测工具和详细经验继续保留在原项目的`dev`分支。

## 提交问题或PR

说明游戏版本、插件版本、复现步骤、预期和实际行为；附种子、难度或必要的脱敏错误信息。不要上传存档、令牌、个人安装备份或完整私人对话。

发行修复可针对`addons/arturia/`或`addons/lavinia/`提交PR；策略改进可附补丁与验证依据。一次PR处理一个问题，不更改游戏规则、原版AI或开局选择概率来获得优势。新策略尚未发布时不作为受支持策略加入仓库目录。

PR经审查后纳入原项目`dev`分支验证。确认改进后运行完整固定测试集，保留原版同开局对照，再同步发行源码、简明说明和最新成绩。公开仓库不维护详细复盘或开发笔记。

## 构建与验证发行包

需要Node.js22+；打包ZIP另需Python3。构建无额外npm依赖：

```powershell
npm test
npm run build
python tools/package-release.py
python tools/package-release.py lavinia
```

集成测试需要独立游戏Git检出，仅在临时目录归档和安装，不修改作为来源的游戏目录：

```powershell
git clone https://github.com/sganggs/Stronghold-Protocol.git .cache/upstream
$env:SP_GAME_REPO = (Resolve-Path .cache/upstream).Path
npm --prefix .cache/upstream ci
npm run test:integration
```

已发布v0.1.0的策略源码与清单保持不可变，构建读取`catalog.json`登记的独立冻结快照。候选改进应与已发布快照分开，不能悄悄改变已有发行包。新版本在开发验证后新增快照和清单，再更新版本登记和构建入口。

遵循GPL-3.0-or-later并保留来源说明。不上传游戏美术、音乐或语音；项目保持非商业同人性质。
