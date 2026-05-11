# OpenClaw Lark/Feishu Plus Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/@hehejie/openclaw-lark-plus.svg)](https://www.npmjs.com/package/@hehejie/openclaw-lark-plus)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22-blue.svg)](https://nodejs.org/)

[中文版](./README.zh.md) | English

`@hehejie/openclaw-lark-plus` is a fork of the official `@larksuite/openclaw-lark`, with one key enhancement: it can reply immediately with a **progress card**, then continuously update the same card with **key execution nodes** (model/tool/skill/error) while OpenClaw runs.

If you want “send a message → instantly get a card → watch it update in-place”, use this plugin.

中文简介：`@hehejie/openclaw-lark-plus` 基于官方 `@larksuite/openclaw-lark` 做了增强：你在飞书/Lark 发消息后会立刻收到一张“执行进度卡片”，OpenClaw 执行过程中会持续更新同一张卡片的关键节点（模型/工具/skill/报错）。

## Quick Start

1. Install the plugin:

```bash
openclaw plugins install @hehejie/openclaw-lark-plus
```

2. Restart OpenClaw Gateway:

```bash
openclaw gateway restart
```

## One-Line Prompt for OpenClaw

Copy and send this as a single message to OpenClaw:

> Please install and enable the OpenClaw Feishu progress-card plugin `@hehejie/openclaw-lark-plus` (plugin id: `openclaw-lark-plus`), ensure it is the only Lark/Feishu plugin enabled to avoid duplicate cards, then restart the OpenClaw gateway and confirm it is working.

中文一键提示词（发给 OpenClaw）：

> 请在我的环境中安装并启用 OpenClaw 飞书进度卡插件 `@hehejie/openclaw-lark-plus`（plugin id: `openclaw-lark-plus`），确保只启用这一套飞书/Lark 插件以避免重复发卡，然后重启 OpenClaw gateway 并确认生效。

## Features

This plugin provides comprehensive Lark/Feishu integration for OpenClaw, including:

| Category | Capabilities |
|------|------|
| 💬 Messenger | Read messages (group/DM history, thread replies), send messages, reply to messages, search messages, download images/files |
| 📄 Docs | Create, update, and read documents |
| 📊 Base | Create/manage bases, tables, fields, records (CRUD, batch operations, advanced filtering), views |
| 📈 Sheets | Create, edit, and view spreadsheets |
| 📅 Calendar | Manage calendars and events (create/query/update/delete/search), manage attendees, check free/busy status |
| ✅ Tasks | Manage tasks (create/query/update/complete), manage task lists, subtasks, and comments |

Additionally, the plugin supports:
- **📱 Progress Cards (Plus)**: Reply immediately with a card and update it in-place with key execution nodes (model/tool/skill/error)
- **🌊 Streaming Responses**: Live streaming text directly within message cards (if enabled by the channel)
- **🔒 Permission Policies**: Flexible access control policies for DMs and group chats
- **⚙️ Advanced Group Configuration**: Per-group settings including allowlists, skill bindings, and custom system prompts

## Security & Risk Warnings (Read Before Use)

This plugin integrates with OpenClaw AI automation capabilities and carries inherent risks such as model hallucinations, unpredictable execution, and prompt injection. After you authorize Lark/Feishu permissions, OpenClaw will act under your user identity within the authorized scope, which may lead to high-risk consequences such as leakage of sensitive data or unauthorized operations. Please use with caution.

To reduce these risks, the plugin enables default security protections at multiple layers. However, these risks still exist. We strongly recommend that you do not proactively modify any default security settings; once relevant restrictions are relaxed, the risks will increase significantly, and you will bear the consequences.

We recommend using the Lark/Feishu bot connected to OpenClaw as a private conversational assistant. Do not add it to group chats or allow other users to interact with it, to avoid abuse of permissions or data leakage.

Please fully understand all usage risks. By using this plugin, you are deemed to voluntarily assume all related responsibilities.


**Disclaimer:**

This software is licensed under the MIT License. When running, it calls Lark/Feishu Open Platform APIs. To use these APIs, you must comply with the following agreements and privacy policies:

- [Feishu Privacy Policy](https://www.feishu.cn/en/privacy?from=openclaw_plugin_readme)
- [Feishu User Terms of Service](https://www.feishu.cn/en/terms?from=openclaw_plugin_readme)
- [Feishu Store App Service Provider Security Management Specifications](https://open.larkoffice.com/document/uAjLw4CM/uMzNwEjLzcDMx4yM3ATM/management-practice/app-service-provider-security-management-specifications)

- [Lark Privacy Policy](https://www.larksuite.com/user-terms-of-service)
- [Lark User Terms of Service](https://www.larksuite.com/privacy-policy)

## Requirements & Installation

Before you start, make sure you have the following:

- **Node.js**: `v22` or higher.
- **OpenClaw**: OpenClaw is installed and works properly. For details, visit the [OpenClaw official website](https://openclaw.ai).

> **Note**: OpenClaw version must be **2026.2.26** or higher. Check with `openclaw -v`. If below this version, you may encounter issues. Upgrade with:
> ```bash
> npm install -g openclaw
> ```

## Usage Guide

[How to Use Lark/Feishu Channel for OpenClaw](https://bytedance.larkoffice.com/docx/MFK7dDFLFoVlOGxWCv5cTXKmnMh)

## Contributing

Community contributions are welcome! If you find a bug or have feature suggestions, please submit an Issue or Pull Request in this repository.

For major changes, we recommend discussing with us first via an Issue.

## License

This project is licensed under the **MIT License**. See [LICENSE](./LICENSE.md) for details.
