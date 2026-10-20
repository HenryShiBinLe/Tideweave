# 最终素材接入表

以下素材已放入 `assets/` 并由 `src/assets.mjs` 注册。节点图按名称中的设施语义自动匹配，状态图与发射源标记独立叠加。

| 素材 | 比例/格式 | 用途 |
|---|---|---|
| `scenes/lanzhou_waterworks.webp` | 1670:941，WebP | 主菜单背景，展示澜州水网工程场景 |
| `textures/project_paper.png` | 1:1，PNG | 工纸质感素材 |
| `textures/waterline.png` | 1:1，透明 PNG | 水脉线纹理素材 |
| `nodes/node_pump_station.png` | 1:1，透明 PNG | 泵站节点 |
| `nodes/node_well.png` | 1:1，透明 PNG | 水井节点 |
| `nodes/node_channel.png` | 1:1，透明 PNG | 渠道、水站节点 |
| `nodes/node_valve.png` | 1:1，透明 PNG | 阀门节点 |
| `nodes/node_warehouse.png` | 1:1，透明 PNG | 仓储节点 |
| `nodes/node_cargo_station.png` | 1:1，透明 PNG | 货运站节点 |
| `nodes/node_receiving_point.png` | 1:1，透明 PNG | 收货站、终端节点 |
| `nodes/node_bridge.png` | 1:1，透明 PNG | 桥梁节点 |
| `nodes/node_sluice.png` | 1:1，透明 PNG | 闸门节点 |
| `nodes/node_power_station.png` | 1:1，透明 PNG | 电站节点 |
| `nodes/node_signal_source.png` | 1:1，透明 PNG | 源站节点 |
| `nodes/node_relay_station.png` | 1:1，透明 PNG | 中继节点 |
| `nodes/node_receiver.png` | 1:1，透明 PNG | 接收站节点 |
| `nodes/node_field_entry.png` | 1:1，透明 PNG | 田间入口节点 |
| `nodes/node_hub.png` | 1:1，透明 PNG | 调度、主站、枢纽节点 |
| `nodes/node_highlight.png` | 1:1，透明 PNG | 选中状态框 |
| `nodes/node_complete.png` | 1:1，透明 PNG | 已确认状态角标 |
| `nodes/node_conflict.png` | 1:1，透明 PNG | 冲突状态角标 |
| `nodes/source_marker.png` | 1:1，透明 PNG | 广播关卡发射源标记 |
| `roads/road_strip.png` | 1983:793，透明 PNG | 无向图道路纹理 |
| `roads/road_arrow.png` | 1:1，透明 PNG | 有向边方向箭头 |
| `actors/dispatch_token.png` | 1:1，透明 PNG | 路线回放当前位置 |
| `scenes/chapter_01_network.webp` | 约 5:3，WebP | 接通信号章的关卡背景 |
| `scenes/chapter_02_transport.webp` | 约 5:3，WebP | 沿路送达章的关卡背景 |
| `scenes/chapter_03_construction.webp` | 约 5:3，WebP | 连网开工章的关卡背景 |
| `scenes/chapter_04_fields.webp` | 约 5:3，WebP | 田区配色章的关卡背景 |
| `scenes/chapter_05_resilience.webp` | 约 5:3，WebP | 守护水城章的关卡背景 |
| `nodes/node_station.png` | 1:1，透明 PNG | 东、南、西、北、中站与孤站，名称由游戏另行显示 |
| `nodes/node_patrol_station.png` | 1:1，透明 PNG | 巡运站 |
| `nodes/node_access_gate.png` | 1:1，透明 PNG | 入口、东口、南口、北关与南关 |
| `nodes/node_network_junction.png` | 1:1，透明 PNG | 西端、东端、北线、中线、南线与汇流 |
| `nodes/node_road_point.png` | 1:1，透明 PNG | 东街、南街、仓街与近路 |
| `nodes/node_riverbank.png` | 1:1，透明 PNG | 河岸与近岸 |
| `nodes/node_harbor.png` | 1:1，透明 PNG | 东港等港口节点 |
| `nodes/node_district.png` | 1:1，透明 PNG | 东区、南区、北区、桥区等城区；田区仍使用田间入口 |
| `nodes/node_group_mask.png` | 3:2，透明 PNG | 设施下方的染色底座，分组编号独立显示 |
| `textures/field_surface_gray.png` | 1:1，灰度 PNG | 按实际田区边界裁切，与玩家选色叠加 |
| `textures/light_panel_gray.png` | 1:1，灰度 PNG | 立体灯面与展开图共用材质，颜色、面名和棱号另行绘制 |

共 41 张素材。工序牌、颜色区域、立体展开图的边界和标注继续由代码绘制，以保持文字清晰和交互稳定。节点图片不会随分组消失；章节背景不会参与点击或判定。素材接入不需要外部 3D 模型，也不使用 WebSocket。

五棱灯塔与十四面灯阵的立体几何、面标签及展开图均由代码生成，共用一张灯面材质；材质缺失时仍可正常操作。

风格参考只取现代工程体量、田畴水系并置、雾白石墨信息层级与青绿点缀；不要复刻《明日方舟》的角色、徽标、专有名词、原画构图或成品界面，不截取视频/PPT 作为素材。

建议描述：清晰可读的现代东方水网工业城市、桥闸与泵站、仓储线与田畴、雾白混凝土和少量赭金工程标记、节制青绿、日间自然光、无人物、无文字、无军事标识、无现有游戏徽标。视觉表现可精致，但不能用复杂装饰遮住实际节点与线路。
