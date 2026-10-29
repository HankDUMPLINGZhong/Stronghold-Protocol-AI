# 卫戍协议 AI 策略合集

为[卫戍协议：盟约 Web 复刻](https://github.com/sganggs/Stronghold-Protocol)开发的具名 AI 队友。**本地规则＋战斗预演，无需 LLM、API Key 或 Token。** 非官方、非商业同人项目。

## 下载

| AI 队友 | 固定开局 | 当前版本 | 安装包与说明 |
|---|---|---|---|
| 祖玛玛（森蚺） | 佩佩／萨尔贡 | v0.2.0 | [下载 ZIP](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases/download/zumama-v0.2.0/AI-Zumama-v0.2.0.zip) · [发行说明与校验](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases/tag/zumama-v0.2.0) |
| 阿尔图罗（图图） | 潘格尼尼／拉特兰 | v0.3.0 | [下载 ZIP](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases/download/arturia-v0.3.0/AI-Arturia-v0.3.0.zip) · [发行说明与校验](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases/tag/arturia-v0.3.0) |
| 拉维妮娅（斥罪） | 贾维／叙拉古 | v0.3.0 | [下载 ZIP](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases/download/lavinia-v0.3.0/AI-Lavinia-v0.3.0.zip) · [发行说明与校验](https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI/releases/tag/lavinia-v0.3.0) |

[全部版本与分类下载](RELEASES.md) · [版本记录](CHANGELOG.md) · [宿主兼容记录](compatibility.json)

## 开始使用

1. **关闭游戏服务**，解压下载的 ZIP。
2. 将插件文件夹放在游戏根目录或便携版启动脚本旁，双击 **安装插件.bat**；也可由安装器手动选择游戏目录。
3. 重启游戏服务并刷新浏览器，在等待室选择 **添加精英干员 → 对应 AI**。

只需房主安装，每房间每位精英各限一名。普通“添加 AI 队友”继续使用原版 AI；精英使用对应干员的精二头像。安装祖玛玛后，精英菜单最多显示两项，其余滚动，键盘也能选择全部项目。

图图 v0.3.0、祖玛玛 v0.2.0 与拉维妮娅 v0.3.0 均使用最新采用基线，沿用安全公共计算层。三款可独立升级并保留其他插件，共用模块自动安装、复用兼容版本并防止降级。请保留 `.ai-addons/install.json` 恢复记录。

[安装、共存与卸载](docs/installation.md) · [扩展分支适配](docs/extended-host-compatibility.md)

<details>
<summary>安装后出现原版 AI、兼容范围与命令行</summary>

网页菜单更新而后台没有重启时，会出现新菜单调用旧处理器的情况。请彻底停止后台服务，从安装插件的同一目录启动，再刷新网页。仅关闭网页或新建房间不能让 Node 重新加载插件。

生效时队友名称应为 `AI·阿尔图罗`、`AI·拉维妮娅`或`AI·祖玛玛`，并选择表中对应策略。三者同场时图图先选、拉维妮娅次之、祖玛玛随后；扩展分支按卡池组分别排序和保留策略。

支持险境、绝境、终极；v0.3.3 适用于默认「第二期下半」，其他官方规则版本不开放精英入口。图图不能用于静态禁用拉特兰的标准模拟。支持的原上游版本、master 快照和 zhewang448 扩展分支提交以[兼容记录](compatibility.json)为准。原上游成绩不作为扩展分支胜率。

这是源码扩展包，不能导入游戏插件工作台。更新游戏前先卸载插件，完成更新后重新安装；安装器会校验文件，遇到已手改或未知结构时拒绝覆盖。不要删除恢复记录强行安装。

在解压的插件目录运行：

```powershell
node .\install.mjs check 'D:\Games\Stronghold-Protocol'
node .\install.mjs install 'D:\Games\Stronghold-Protocol'
node .\install.mjs uninstall 'D:\Games\Stronghold-Protocol'
```

需要 Node.js 22+；双击入口优先使用游戏自带 Node。

</details>

## 策略与成绩

| AI | 单人绝境 | 单人终极 | 二人终极 | 四人终极 | 策略与详细指标 |
|---|---:|---:|---:|---:|---|
| 祖玛玛／萨尔贡 | 28/28 | 15/28 | 20/56 | 20/56 | [策略说明](docs/strategies/sargon.md) |
| 阿尔图罗／拉特兰 | 28/28 | 20/28 | 22/56 | 24/56 | [策略说明](docs/strategies/laterano.md) |
| 拉维妮娅／叙拉古 | 28/28 | 18/28 | 20/56 | 16/56 | [策略说明](docs/strategies/siracusa.md) |

单人与多人使用各自冻结的诊断集；二人为一位对应 AI＋原版 bot，四人为一位对应 AI＋3 位原版 bot。胜场均指 R14 领袖过关。测试关闭随机盟约禁用，先按敌人环境选种，不读取 AI 胜负；这些结果不是自然随机开局胜率。各策略的具体配置、队友调度与基线来源分别记录，不混算或合并人数。

每位 AI 的多人详细表仍仅列二人、四人两行，包含胜场、队伍到达回合、本人有效核心层数、普通波漏怪和联防兜怪；提前淘汰的对局也计入平均值。

[测评集、逐局结果与口径](benchmarks/README.md) · [策略目录](docs/strategies/README.md)

## 开发与贡献

本仓库保存已发布策略的完整冻结源码、构建入口和验证数据，接收 Issue／PR；日常策略研究保留在原项目开发分支。策略负责候选和评分，[共用计算模块](docs/computation.md)负责执行，游戏规则仍由宿主负责。

```powershell
npm test
npm run build
python tools/package-release.py zumama
```

[贡献与发行规范](CONTRIBUTING.md) · [GPL-3.0-or-later](LICENSE) · [来源说明](provenance.json)

三款插件独立编号与 Tag；已有版本的源码、标签和附件保持不变。GitHub Latest 继续指向图图最新正式版，下载其他 AI 请用上方独立链接。
