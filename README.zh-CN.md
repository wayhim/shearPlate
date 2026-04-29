# ShearPlate

[English](./README.md) | [简体中文](./README.zh-CN.md)

ShearPlate 是一个使用 Electron、React 和 TypeScript 构建的剪贴板管理器。它主要以托盘应用方式运行，在本地记录剪贴板历史，并支持快速搜索、预览、复制，以及回贴到当前活跃输入目标。

当前版本：`0.1.2`

## 功能概览

- 记录文本、图片和文件类型的剪贴板历史
- 关闭窗口时不退出，继续在系统托盘运行
- 支持全局快捷键唤起，默认 `Alt+V`
- 支持搜索、收藏和自定义片段（Snippet）
- 使用 `sql.js` 将数据本地存储在 SQLite
- 支持浅色、深色和跟随系统主题
- 内置单实例保护，避免重复进程
- 提供本地重启脚本，便于开发和打包流程

## 当前状态

这个仓库目前是一个本地优先（local-first）的剪贴板工具。数据模型里已经预留了一些设备相关字段，但当前行为仍是单设备、本地使用。`0.1.2` 不包含跨设备同步。

## 技术栈

- Electron 33
- React 18
- TypeScript
- `electron-vite`
- Tailwind CSS
- Zustand
- `sql.js`
- `@tanstack/react-virtual`

## 主要特性

### 剪贴板采集

应用会轮询系统剪贴板，并将新内容写入本地数据库。

- 文本内容会作为可搜索的历史记录保存
- 图片可预览，并在需要时落地为本地文件
- 文件复制会记录路径、大小等元信息
- 通过哈希与去重逻辑减少重复记录

### 快速召回

ShearPlate 的定位是“快速取回”，不是完整笔记应用。

- 按内容类型筛选
- 搜索剪贴板历史
- 收藏重要条目
- 将条目提升为可复用的片段（Snippet）

### 回贴接力

当你在面板里选择某个条目时，ShearPlate 会先写回剪贴板，再尝试回贴到之前活跃的应用。

- macOS 使用 AppleScript / System Events
- Windows 使用前台窗口定位 + 模拟 `Ctrl+V`
- 在 macOS 上需要“辅助功能”权限，有时还需要“自动化”权限

### 托盘优先行为

应用尽量不打扰 Dock / 任务栏工作流。

- 关闭窗口只会隐藏面板
- 托盘图标保持可用
- 可通过托盘或全局快捷键重新唤起

## 项目结构

```text
src/
  main/                 Electron 主进程
    clipboard/          剪贴板监听与回贴逻辑
    store/              SQLite 持久化与设置
    system/             预览与文件/图片系统辅助
  preload/              安全的渲染进程桥接
  renderer/             React 界面
  shared/               共享类型与布局常量
docs/
  MANUAL.md             面向用户的手册
scripts/
  restart-app.sh        本地重建 + 重启脚本
resources/
  图标与打包资源
```

## 本地数据

剪贴板数据只存储在本地。

- macOS: `~/Library/Application Support/shear-plate/shearplate.db`
- Windows: `%APPDATA%/shear-plate/shearplate.db`
- Linux: `~/.config/shear-plate/shearplate.db`

应用不依赖独立数据库服务。

## 环境要求

- 建议 Node.js 20+
- `npm`
- 当前桌面行为主要维护 macOS 与 Windows

虽然运行时路径中包含 Linux 的部分支持，但 Linux 不是当前打包流程的主目标。

## 快速开始

```bash
git clone https://github.com/wayhim/shearPlate.git
cd shear_plate
npm install
npm run dev
```

本地产出生产构建：

```bash
npm run build
```

## 可用脚本

```bash
npm run dev          # 启动 Electron 开发模式
npm run build        # 构建 main/preload/renderer
npm run preview      # 预览 renderer 生产构建
npm run typecheck    # TypeScript 类型检查
npm run dist:mac     # 构建已签名+已公证的 macOS dmg+zip
npm run dist:mac:unsigned # 构建未签名本地包（不用于分发）
npm run dist:mac:dir # 构建未封装的 macOS .app
npm run dist:win     # 构建 Windows portable 包
npm run restart:app  # 本地重建并重启应用
```

## macOS 安装

为了权限与应用身份稳定，建议使用 `/Applications` 下的打包应用，不要反复从临时构建目录启动。

典型本地流程：

```bash
npm run dist:mac:dir
open release/mac-arm64/ShearPlate.app
```

如果你希望它像正常安装应用一样工作，请将 `release/mac-arm64/ShearPlate.app` 复制到 `/Applications/ShearPlate.app` 后再启动。

如果 macOS 提示应用“已损坏”，可使用下面命令临时移除隔离标记：

```bash
# 先把 app 拖到 Applications
xattr -dr com.apple.quarantine /Applications/ShearPlate.app
open /Applications/ShearPlate.app
```

## macOS 权限

自动回贴是否成功依赖 macOS 权限设置。

你可能需要允许：

- `ShearPlate`：`系统设置 -> 隐私与安全性 -> 辅助功能`
- `ShearPlate`：`系统设置 -> 隐私与安全性 -> 自动化`
- 如系统提示，允许对 `System Events` 的控制

如果这些权限缺失，剪贴板历史仍可记录，但自动回贴可能失败。

## macOS 签名发布（分发必需）

未签名的 macOS 应用下载后可能被 Gatekeeper 判定为“已损坏”。本项目已将“签名 + 公证”作为默认发布路径。

1. 在 macOS 钥匙串中安装有效的 `Developer ID Application` 证书。
2. 按以下两种方式之一配置公证凭据：

```bash
# 方式 A：App Store Connect API Key
export APPLE_API_KEY="/absolute/path/AuthKey_XXXXXX.p8"
export APPLE_API_KEY_ID="XXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# 方式 B：Apple ID + app 专用密码
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID1234"
```

可选：指定签名证书名

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID1234)"
```

构建发布包：

```bash
npm run dist:mac
```

发布脚本会校验：

- 签名有效性（`codesign --verify`）
- Gatekeeper 评估（`spctl --assess`）
- 公证票据（`xcrun stapler validate`）

## 打包说明

- macOS 产物输出到 `release/`
- 应用配置为 `LSUIElement`，行为是托盘/菜单栏工具
- `npm run dist:mac` 现在必须具备签名与公证凭据，否则会快速失败
- Windows 当前打包目标为 portable

## 开发说明

- 主进程中已做单实例保护
- 本地重启辅助脚本在 `scripts/restart-app.sh`
- 重启脚本使用的运行日志和 PID 文件保存在 `.runtime/`
- 仓库可能包含本地 `arboard` gitlink 状态，处理无关改动时请谨慎

## 故障排查

### 能记录剪贴板，但无法回贴

通常是 macOS 权限问题。

检查：

- 辅助功能权限是否开启
- 如有提示，自动化权限是否开启
- 是否一直从同一路径启动安装版应用（避免在多个 app 路径间切换）

### 快捷键不生效

可能被其他应用占用。应用会谨慎回退，但全局快捷键仍可能被系统或其他应用拦截。

### 关窗后应用还在运行

这是预期行为。ShearPlate 以托盘优先，关闭面板不等于退出应用。

## 文档

- 用户手册：`docs/MANUAL.md`

## 许可证

仓库根目录目前还没有许可证文件。对外分发前建议补充。
