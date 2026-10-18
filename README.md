# 卫戍协议 AI 策略合集

为[卫戍协议：盟约 Web 复刻](https://github.com/sganggs/Stronghold-Protocol)开发的 AI 队友与策略。**本地规则决策＋战斗预演，不接 LLM，不用 API Key，没有 Token 消耗。**

本仓库用于发布策略插件、公开发行源码及接收PR；日常开发和详细经验仍保留在原项目的`dev`分支。当前可安装 **AI·阿尔图罗 v0.1.2（拉特兰）** 和 **AI·拉维妮娅 v0.1.1（叙拉古）**。

## 下载与安装

按插件查看版本：[阿尔图罗（图图）的全部版本](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases?q=%22addon-arturia%22) · [拉维妮娅的全部版本](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases?q=%22addon-lavinia%22) · [分类下载索引](RELEASES.md)

**[下载拉维妮娅 v0.1.1 安装包](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases/download/lavinia-v0.1.1/AI-Lavinia-v0.1.1.zip)** · [拉维妮娅版本与校验文件](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases/tag/lavinia-v0.1.1)

解压后双击“安装插件.bat”；游戏等待室通过 **添加精英干员 → 拉维妮娅** 添加，使用斥罪精二头像，优先且只选贾维／叙拉古。单独在场第一选；与图图同场时图图第一、拉维妮娅第二。共存时先安装阿尔图罗，再安装拉维妮娅；升级／卸载阿尔图罗前先卸载拉维妮娅，详见[拉维妮娅安装说明](addons/lavinia/README.md)。

**[下载阿尔图罗 v0.1.2 安装包](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases/download/v0.1.2/AI-Arturia-v0.1.2.zip)** · [版本与校验文件](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases/tag/v0.1.2)

改动与历史成绩见[版本记录](CHANGELOG.md)。升级时关闭服务，运行新版“安装插件.bat”，会校验并自动升级已完整安装的旧版。

1. 关闭游戏服务，解压安装包。
2. 将解压后的 `AI-Arturia-v0.1.2` 文件夹放进游戏根目录，或便携版“启动游戏.bat”旁边。
3. 双击 **安装插件.bat**。安装器会识别游戏和 Node，自动创建并写入 `addons/arturia`；找不到目录时可手动选择。
4. 使用原来的启动脚本重启游戏，刷新浏览器，在等待室点击 **添加精英干员 → 阿尔图罗**。

普通“添加 AI 队友”仍使用原版 AI。只需房主安装，每个房间最多一位阿尔图罗。支持险境、绝境、终极；标准模拟禁用拉特兰，因此不能添加她。

已验证游戏版本：本地保留的 **0.2.4** 与上游 **0.3.0**。它是修改少量接入文件的源码扩展包，不能从游戏插件工作台导入；0.3.0 当前支持原版玩法及纯外观插件。升级游戏前先卸载，详见[安装说明](addons/arturia/README.md)。

### 命令行方式

在解压后的插件目录执行，替换成你的游戏路径：

```powershell
node .\install.mjs check 'D:\Games\Stronghold-Protocol'
node .\install.mjs install 'D:\Games\Stronghold-Protocol'
node .\install.mjs uninstall 'D:\Games\Stronghold-Protocol'
```

下载整个源码仓库也可以使用根目录的 **安装插件.bat**，或执行：

```powershell
node .\addons\arturia\install.mjs install 'D:\Games\Stronghold-Protocol'
```

便携版命令行目标应为 `app` 目录；双击入口会自动识别。安装时保留的 `.arturia-addon/install.json` 用于原文件恢复，请勿删除。

## 已发布策略与成绩

当前发布 **AI·阿尔图罗 v0.1.2（拉特兰）** 与 **AI·拉维妮娅 v0.1.1（叙拉古）**。

以下为`enemy-diversity-v1`固定**单人**测评集，每难度28局、关闭随机盟约禁用，使用真实战斗。过关指击败R14领袖，不等于隐藏Boss全清，不代表多人房或自然开局胜率。

阿尔图罗与原版采用**相同潘格尼尼／拉特兰开局**：

| AI | 绝境胜场 | 绝境平均存活回合 | 绝境R13平均拉特兰层数 | 终极胜场 | 终极平均存活回合 | 终极R13平均拉特兰层数 |
|---|---:|---:|---:|---:|---:|---:|
| 原版 bot | 4/28 | 13.00 | 38.15（26局） | 0/28 | 11.43 | 37.56（16局） |
| 阿尔图罗／拉特兰 | **27/28** | **14.11** | **106.36（28局）** | **9/28** | **12.64** | **113.00（23局）** |

拉维妮娅与原版采用**相同贾维／叙拉古开局**：

| AI | 绝境胜场 | 绝境平均存活回合 | 绝境R13平均叙拉古层数 | 终极胜场 | 终极平均存活回合 | 终极R13平均叙拉古层数 |
|---|---:|---:|---:|---:|---:|---:|
| 原版 bot | 3/28 | 12.82 | 46.48（25局） | 0/28 | 10.57 | 36.00（10局） |
| 拉维妮娅／叙拉古 | 27/28 | 14.71 | 270.36（28局） | 11/28 | 12.04 | 265.70（20局） |

叙拉古完整开发矩阵448局验证通过，主56局复现27/11，其余392局对照不变；补充16局为8/8、2/8。

存活回合取全部28局已通过回合的均值；层数只统计到达R13检查点的局，括号为样本数，提前淘汰不混入0层。

测试集先生成 **10,000** 个候选种子的敌人环境，再按 **7** 类关底Boss、**7** 张地图及中途敌人的种类／组合覆盖选出 **28** 个固定种子。**选种不读取AI胜负。** 绝境、终极分别运行；它是均衡诊断集，不是未见留出集。

[策略总纲与完整同开局对照](docs/strategies/README.md) · [测评集与固定种子](benchmarks/README.md) · [逐局结果](benchmarks/results.json)

## 源码与贡献

| 目录 | 内容 |
|---|---|
| `addons/arturia/`、`addons/lavinia/` | 两位精英干员的独立插件、安装器与构建入口 |
| `benchmarks/` | 固定场景、两位精英干员与各自原版的224局对照、校验入口 |
| `test/` | 发行包哈希、构建与宿主安装集成回归 |
| `docs/strategies/` | 简明策略介绍与当前测评数据 |
| `releases/` | 已发布策略的固定哈希、版本与来源清单 |

已发布策略登记在[catalog.json](catalog.json)，保留独立源码快照。只包含已发布干员发行所需的依赖闭包；内部依赖不是独立发布或承诺支持的其他策略。新策略确认发布后再加入目录。

构建无需访问原私有仓库或其Git历史：

```powershell
npm test
npm run build
python tools/package-release.py
python tools/package-release.py lavinia
```

产物位于 `dist/`。构建校验每位干员各自发行清单中的策略哈希；打包脚本生成 ZIP 与 SHA-256。旧版快照与清单保留在`releases/`。策略不是独立游戏，需要游戏作为宿主；参与方式见[贡献说明](CONTRIBUTING.md)。

欢迎提交问题和PR。PR将纳入原项目`dev`分支验证，确认版本后再同步发行源码与成绩。**每次策略开发闭环都运行统一测试集并更新README。** 简要模块说明见[策略框架](docs/strategies/framework.md)。

## 来源与许可

策略在[原游戏仓库](https://github.com/sganggs/Stronghold-Protocol)基础上开发，软件遵循 **GPL-3.0-or-later**，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。迁移来源及固定提交记录在 [provenance.json](provenance.json)。

本仓库不包含游戏立绘、头像、音乐、语音、存档或个人安装备份。两位精英干员头像使用玩家游戏已有素材。明日方舟相关名称和素材归原权利方所有；本项目为非官方、非商业同人扩展。
