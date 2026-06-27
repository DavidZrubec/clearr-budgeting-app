# Obsidian-OpenCode Integration Design

**Date:** 2025-06-25
**Status:** Approved
**Project:** Clearr Budgeting / OpenCode Ecosystem

## Overview

Connect OpenCode agents to the Obsidian "Second-Brain" vault via an MCP server, enabling:
- Read/write/search access to vault notes as agent tools
- Persistent agent memory storage in the vault
- Structured folder hierarchy for plans, specs, memories, and logs

## Architecture

An MCP server (Node.js, TypeScript, `@modelcontextprotocol/sdk`) wraps the Obsidian CLI as the primary communication mechanism, with optional REST API plugin fallback for performance.

```
OpenCode Agent → MCP Server → Obsidian CLI → Obsidian vault
                              → REST API (optional, if plugin installed)
```

## MCP Tools

| Tool | Description | CLI Mapping |
|---|---|---|
| `read_note` | Read a note by name/path | `obsidian read` |
| `write_note` | Create or overwrite a note | `obsidian create` / write |
| `search_notes` | Full-text search across vault | `obsidian search:context` |
| `list_notes` | List files in a folder | `obsidian files` |
| `append_to_note` | Append content to a note | `obsidian append` |
| `delete_note` | Delete a note | `obsidian delete` |
| `list_vaults` | List available vaults | `obsidian vaults` |
| `list_tasks` | List tasks in vault | `obsidian tasks` |
| `create_from_template` | Create note from template | `obsidian template:insert` |
| `run_command` | Execute any Obsidian command | `obsidian command` |
| `search_agent_memories` | Search in agent memory folder | `obsidian search:context` + path filter |

## Agent Memory System

Vault structure inside `Second-Brain`:

```
Second-Brain/
└── opencode/
    ├── agents/           # Agent definitions
    ├── memories/         # Persistent session context
    ├── plans/            # Implementation plans
    ├── specs/            # Design documents
    └── logs/             # Session summaries
```

Each note uses YAML frontmatter:
```yaml
---
type: memory | spec | plan | log
project: <project-name>
status: active | archived | draft
tags: [opencode, ...]
---
```

## Installation

- MCP server lives at `/Users/david/Documents/Code/budgeting app/obsidian-mcp/`
- Node.js project with `@modelcontextprotocol/sdk`, TypeScript
- Built with `tsc`, registered in OpenCode config

## OpenCode Config

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["<path>/obsidian-mcp/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT": "Second-Brain",
        "OBSIDIAN_CLI_PATH": "/usr/local/bin/obsidian"
      }
    }
  }
}
```

## Future Enhancements

- REST API plugin integration for faster reads/writes
- Agent auto-logging of session summaries
- Bidirectional sync between `.opencode/agents/` and vault `opencode/agents/`
