# ShearPlate 使用手册

**版本：** 0.1.0
**平台：** macOS / Windows / Linux

---

## 简介

ShearPlate 是一款跨端剪切板管理工具，自动记录你的复制历史，让你随时查找和复用之前复制过的内容。当前版本为本地单机版，后续将支持多设备同步。

---

## 快速开始

### 安装

```bash
# 克隆项目
git clone <repo-url> shear-plate
cd shear-plate

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建生产包
npm run build
```

### 首次启动

启动后，ShearPlate 会在系统托盘区（macOS 菜单栏右侧）出现一个剪贴板图标。从这一刻起，你复制的所有文本内容都会被自动记录。

---

## 核心功能

### 1. 剪切板监控

ShearPlate 每 300 毫秒检测一次系统剪切板变化。当你复制任何文本时（`Cmd+C` / `Ctrl+C`），内容会自动保存到本地 SQLite 数据库。

- 支持类型：文本（Text）、图片（Image）、文件（File）
- 自动去重：相同内容不会重复记录
- 数据存储位置：
  - macOS：`~/Library/Application Support/shear-plate/shearplate.db`
  - Windows：`%APPDATA%/shear-plate/shearplate.db`
  - Linux：`~/.config/shear-plate/shearplate.db`

### 2. 全局快捷键

| 快捷键 | 功能 |
|--------|------|
| `Cmd+Shift+V` (macOS) | 呼出 / 聚焦 ShearPlate 面板 |
| `Ctrl+Shift+V` (Windows/Linux) | 呼出 / 聚焦 ShearPlate 面板 |

无论你正在使用什么应用，按下快捷键即可立即打开 ShearPlate 查看剪切板历史。

### 3. 系统托盘

ShearPlate 在关闭窗口后不会退出，而是常驻在系统托盘中：

- **右键托盘图标**：显示菜单
  - `Open Panel` — 打开主面板
  - `Quit` — 完全退出应用
- **打开主面板**：使用全局快捷键，或从托盘菜单中选择 `Open Panel`

---

## 界面说明

主界面从上到下分为四个区域：

### 标题栏

- 左侧：ShearPlate 图标和名称
- 右侧：
  - **主题切换按钮**（太阳/月亮图标）— 切换亮色/暗色模式
  - **关闭按钮**（X 图标）— 隐藏窗口（应用继续运行）

### 搜索栏

- 输入关键词搜索剪切板历史，支持模糊匹配
- 输入时有 200ms 防抖延迟，避免频繁查询
- 快捷键提示：`⌘V`

### 筛选栏

提供五个筛选按钮快速过滤内容：

| 按钮 | 功能 |
|------|------|
| **All** | 显示全部记录 |
| **Text** | 仅显示文本类型 |
| **Image** | 仅显示图片类型 |
| **File** | 仅显示文件类型 |
| **Starred** | 仅显示已收藏的记录 |

### 历史列表

每条记录以卡片形式展示，包含以下信息：

- **类型图标**：根据内容类型显示不同图标和底色
  - 文本（蓝色）
  - 图片（靛蓝色）
  - 文件（橙黄色）
- **内容预览**：显示复制文本的单行预览
- **时间戳**：显示 "Just now"、"3m ago"、"2h ago" 或日期
- **文件大小**：文件类型时显示（如 "1.2 KB"）
- **设备标签**：显示内容来源设备，不同平台用不同颜色区分
  - Mac / MacBook → 紫色
  - Windows / PC → 蓝色
  - iPhone / iOS → 橙色
  - Android → 绿色

#### 卡片操作

鼠标悬停到卡片上时，右侧会显示三个操作按钮：

| 按钮 | 功能 | 说明 |
|------|------|------|
| **Copy** | 复制到剪切板 | 点击后图标变为 ✓，表示已复制成功 |
| **Star** | 收藏/取消收藏 | 收藏后星标变实心高亮，可通过 "Starred" 筛选查看 |
| **Delete** | 删除记录 | 从数据库中永久删除该条记录 |

---

## 主题

ShearPlate 支持亮色和暗色两种模式：

- **跟随系统**：首次启动时自动检测系统主题
- **手动切换**：点击标题栏的太阳/月亮按钮切换
- 设计遵循 macOS 美学，使用 -apple-system 字体，13px 基准字号

---

## 数据安全

- 所有数据存储在本地 SQLite 数据库中，不会上传到任何服务器
- 数据库使用 sql.js（WASM 版 SQLite），无需安装额外系统依赖
- 每次写入操作后自动保存到磁盘

---

## 技术架构

| 组件 | 技术选型 |
|------|----------|
| 桌面框架 | Electron 33 |
| 前端框架 | React 18 + TypeScript |
| 构建工具 | electron-vite |
| 样式方案 | Tailwind CSS + CSS 自定义属性（设计令牌） |
| 状态管理 | Zustand |
| 本地数据库 | sql.js（WASM 版 SQLite） |
| 虚拟滚动 | @tanstack/react-virtual |
| 图标库 | Lucide React |

---

## 常见问题

**Q：为什么复制了内容但列表没有更新？**
A：请确认 ShearPlate 正在运行（检查系统托盘是否有图标）。如果使用的是开发模式，请确认 Electron 进程未崩溃。

**Q：关闭窗口后应用还在运行吗？**
A：是的。关闭窗口只是隐藏面板，应用仍在后台监控剪切板。如需完全退出，请通过托盘菜单选择 "Quit"。

**Q：快捷键不生效怎么办？**
A：可能是快捷键被其他应用占用。ShearPlate 默认使用 `Cmd/Ctrl+Shift+V`，如果注册失败会在控制台输出警告。

**Q：数据库文件可以删除吗？**
A：可以。删除后 ShearPlate 会在下次启动时自动创建新的空数据库，但所有历史记录会丢失。

**Q：支持同步到其他设备吗？**
A：当前版本（0.1.0）为本地单机版，暂不支持多设备同步。跨设备同步功能计划在后续版本中实现。

---

## 开发命令

```bash
npm run dev          # 启动开发模式（热重载）
npm run build        # 构建生产包
npm run preview      # 预览生产构建
npm run typecheck    # TypeScript 类型检查
```
