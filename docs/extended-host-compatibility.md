# 扩展宿主适配

阿尔图罗v0.2.4支持[zhewang448/Stronghold-Protocol](https://github.com/zhewang448/Stronghold-Protocol)的`v0.3.1-extended.9`（`fddf41fe8f5b85e87951d85b53df2d800948a387`）。图图v0.2.3及更早的安装包不能直接用于此分支。拉维妮娅的扩展适配单独保留开发，现有v0.1.2安装文件与发行附件不变，本次只发布图图。

安装器根据分组轮选与等待室代码识别宿主，不依赖目录、Git remote或基础版本号。原上游继续按原流程安装；已知扩展结构使用专用接入步骤，未知或重复接入点在写入前拒绝。单独安装、升级和卸载均通过恢复记录保护原文件。

扩展接入支持等待室精英入口与头像、图图在自己卡池组内优先选择潘格尼尼及组内策略保留，其他分组仍可选择同一策略。冻结AI通过每位玩家的视图读取自己的棋子和装备池，普通AI与宿主规则保持原样。

回档快照不复制含函数的衍生策略缓存，恢复后重新计算；重启恢复时从保存的房间座位补回精英身份，棋盘、经济、层数与实际AI状态仍由宿主保存。

完整战斗兼容检查覆盖单人、二人及四人至R14；4／5／8／20人验证组内轮选和卡池，8／20人补测非首组精英准备流程。20人完整对局效果未做基线测评，原上游胜率不作为扩展分支成绩。

测试命令：

```powershell
$env:SP_GAME_REPO = 'D:\isolated\extended-host'
$env:SP_BASE_REPO = 'D:\isolated\upstream'
$env:ARTURIA_TEST_REF = 'fddf41fe8f5b85e87951d85b53df2d800948a387'
node --test test/integration/arturia.test.mjs test/integration/arturia-upgrade.test.mjs
npm run test:extended
```

原上游继续使用完整`npm run test:integration`，包含两款共存、旧版升级、事务恢复及逐字节卸载；专项检查另对0.2.4、0.3.1和已支持master快照比较原上游补丁一致性。
