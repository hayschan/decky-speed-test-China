# decky-speed-test-China（高校测速）

一个面向中国大陆 SteamOS 用户的 Decky 网络测速插件。插件不再依赖 Cloudflare，
改用国内高校提供的 LibreSpeed 测速节点，并保留适合 Steam Deck 游戏模式的紧凑界面。
它使用独立的 `decky-speed-test-China` 插件身份，不会覆盖商店中的原版 `Speed Test`。

当前版本：**v2.0.1**

## 测速节点

| 节点 | 地址 | IPv4 | IPv6 |
| --- | --- | --- | --- |
| 中国科学技术大学 | [test.ustc.edu.cn](https://test.ustc.edu.cn/) | 可指定 | 可指定 |
| 南京大学 | [test.nju.edu.cn](https://test.nju.edu.cn/) | 可指定 | 可指定 |
| 南京航空航天大学 | [speed.nuaa.edu.cn](http://speed.nuaa.edu.cn/) | 站点默认 | 不支持指定 |

中科大测速站的实现可见 [bg6cq/speedtest](https://github.com/bg6cq/speedtest)，
三个节点均使用兼容 LibreSpeed 的 `garbage.php`、`empty.php` 和 `getIP.php` 接口。

## 功能

- 在中科大、南大和南航三个节点之间切换。
- 中科大、南大支持指定 IPv4 或 IPv6；南航使用站点默认线路。
- 可选择多个节点，按顺序完成测速后计算成功节点的算术平均值。
- 实时显示下载、上传、延迟、抖动和负载延迟曲线。
- 设置自动持久化。
- 自动保存最近 50 次测速记录，可展开查看各节点结果。
- 网络请求由 Decky Python 后端执行，避免 Steam 客户端的跨域和 HTTP 混合内容限制。

多节点不会并发跑满多个服务器。顺序测速可以避免测试流量互相争抢同一条宽带，从而让平均值更有参考意义。若部分节点临时不可用，插件会继续测试其他节点，并只使用成功结果计算平均值。

## 安装

通过 [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) 安装。

如需手动安装，请从
[GitHub Releases](https://github.com/hayschan/decky-speed-test-China/releases/latest)
下载 `decky-speed-test-China.zip`。压缩包内已包含编译后的前端、Python 后端和插件清单，
无需在 Steam Deck 上安装 Node.js 或重新编译。

## 开发

```bash
pnpm install
pnpm build
```

前端使用 `@decky/ui` 和 `@decky/api`。测速、南大 Anubis 验证以及 JSON
历史记录由根目录的 `main.py` 负责；设置和历史数据写入 Decky 为插件分配的设置目录。
