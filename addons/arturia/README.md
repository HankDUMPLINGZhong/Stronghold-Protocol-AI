# AI·阿尔图罗 v0.2.0 · 拉特兰卫戍专家

本地规则决策＋战斗预演，不接LLM。显式添加后选潘格尼尼并执行拉特兰策略；普通AI保持原版。每房间最多一位，支持险境、绝境、终极；标准模拟禁用拉特兰，因此不支持。

已验证宿主：0.2.4（3e589285）、0.3.0（6ab24682）、0.3.1（b3deebda）与2026-10-21核验的master快照（c9d804f4）。v0.2.0在0.2.4与0.3.1各通过26项单独／共存安装、真实战斗至R14、旧版策略升级和卸载回归；其他宿主由发行CI验证。新增验证记录见仓库`compatibility.json`，发行清单保留最初来源提交。这是带安装器的源码扩展包，不能从游戏插件工作台导入；仅支持原版玩法和纯外观插件，暂不支持改变玩法的内容插件。

## Windows安装

1. 关闭游戏服务，把插件文件夹放进游戏根目录或便携版“启动游戏.bat”旁边。
2. 双击**安装插件.bat**；自动识别游戏及Node，找不到游戏时可选择目录。
3. 安装器自动创建`addons/arturia`。重启游戏、刷新浏览器，在等待室选择**添加精英干员→阿尔图罗**。

优先使用便携版自带Node，其次使用系统Node22+，无需管理员权限或Git。精二头像来自游戏已有素材，插件不携带游戏美术。

## 命令行安装与卸载

在插件目录执行：

```powershell
node .\install.mjs check 'D:\Games\Stronghold-Protocol'
node .\install.mjs install 'D:\Games\Stronghold-Protocol'
node .\install.mjs uninstall 'D:\Games\Stronghold-Protocol'
```

便携版目标指定`app`目录，或使用会自动识别的Windows入口。安装后的卸载入口：

```powershell
node .\addons\arturia\install.mjs uninstall .
```

安装前校验接入点和策略哈希，原文件保存在`.arturia-addon/install.json`用于恢复，请勿删除。卸载前关闭服务；安装后被修改的文件会拒绝覆盖。升级游戏前先卸载，升级后重新检查兼容性。

升级旧版时关闭服务，运行新版“安装插件.bat”即可自动升级；原安装文件被修改时会拒绝覆盖，升级失败会恢复旧版。详见[版本记录](CHANGELOG.md)。

## 成绩与源码

冻结策略`team27-early-three`：固定单人测试集绝境27/28、终极16/28；同开局原版4/28、0/28。这是0.2.4开发宿主的诊断集，不代表多人房胜率；补充28局绝境14/14、终极6/14，存在已接受的终极样本回退。

源码、简单策略介绍、测试集与发行记录：
https://github.com/HankDUMPLINGZhong/Stronghold-Protocol-AI

`addon.json`记录逐文件SHA-256与策略指纹，冻结源码见`releases/arturia-v0.2.0/source/`。源码仓库可独立运行`npm test`、`npm run build`，无需原私有仓库；贡献方式见仓库CONTRIBUTING.md。

GPL-3.0-or-later，见LICENSE。非官方、非商业同人项目；游戏名称及美术归原权利方所有。
