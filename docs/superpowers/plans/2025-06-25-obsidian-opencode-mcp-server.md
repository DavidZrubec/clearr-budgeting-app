# Obsidian-OpenCode MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that gives OpenCode agents read/write/search access to the Obsidian "Second-Brain" vault, with a persistent agent memory system.

**Architecture:** Node.js MCP server using `@modelcontextprotocol/sdk` that wraps the Obsidian CLI into MCP tools. Agent memories stored in `opencode/` folder within the vault. Optional REST API fallback for performance.

**Tech Stack:** Node.js, TypeScript, `@modelcontextprotocol/sdk`, Obsidian CLI

---

### Task 1: Scaffold the MCP project

**Files:**
- Create: `/Users/david/Documents/Code/budgeting app/obsidian-mcp/package.json`
- Create: `/Users/david/Documents/Code/budgeting app/obsidian-mcp/tsconfig.json`
- Create: `/Users/david/Documents/Code/budgeting app/obsidian-mcp/.gitignore`

- [ ] **Step 1: Create the project directory and initialize**

```bash
mkdir -p /Users/david/Documents/Code/budgeting\ app/obsidian-mcp/src
cd /Users/david/Documents/Code/budgeting\ app/obsidian-mcp
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "obsidian-mcp",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.17.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
```

- [ ] **Step 5: Install dependencies**

Run: `npm install` in `obsidian-mcp/`
Expected: packages installed, `node_modules/` created

---

### Task 2: Build the Obsidian CLI wrapper

**Files:**
- Create: `/Users/david/Documents/Code/budgeting app/obsidian-mcp/src/obsidian.ts`

- [ ] **Step 1: Create the CLI wrapper module**

This module wraps every `obsidian` CLI command we need as typed async functions.

```typescript
import { execa } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execa)

function getCliPath(): string {
  return process.env.OBSIDIAN_CLI_PATH || '/usr/local/bin/obsidian'
}

function getVault(): string {
  return process.env.OBSIDIAN_VAULT || ''
}

function vaultArg(): string[] {
  const v = getVault()
  return v ? [`vault=${v}`] : []
}

export interface Note {
  name: string
  path: string
  content?: string
}

export interface SearchResult {
  file: string
  line: number
  content: string
}

export interface VaultInfo {
  name: string
  path: string
  files: number
  folders: number
  size: number
}

export async function readNote(fileOrPath: string): Promise<string> {
  const isPath = fileOrPath.includes('/')
  const arg = isPath ? `path=${fileOrPath}` : `file=${fileOrPath}`
  const { stdout } = await exec(getCliPath(), ['read', arg, ...vaultArg()])
  return stdout
}

export async function writeNote(name: string, content: string): Promise<string> {
  const { stdout } = await exec(getCliPath(), [
    'create', `name=${name}`, `content=${content}`, 'overwrite', ...vaultArg(),
  ])
  return stdout
}

export async function searchVault(query: string, folder?: string): Promise<SearchResult[]> {
  const args = ['search:context', `query=${query}`]
  if (folder) args.push(`path=${folder}`)
  args.push('format=json', ...vaultArg())
  const { stdout } = await exec(getCliPath(), args)
  return JSON.parse(stdout) as SearchResult[]
}

export async function listNotes(folder?: string): Promise<Note[]> {
  const args = ['files']
  if (folder) args.push(`folder=${folder}`)
  args.push('format=json', ...vaultArg())
  const { stdout } = await exec(getCliPath(), args)
  return JSON.parse(stdout) as Note[]
}

export async function appendNote(fileOrPath: string, content: string): Promise<string> {
  const isPath = fileOrPath.includes('/')
  const arg = isPath ? `path=${fileOrPath}` : `file=${fileOrPath}`
  const { stdout } = await exec(getCliPath(), ['append', arg, `content=${content}`, ...vaultArg()])
  return stdout
}

export async function deleteNote(fileOrPath: string): Promise<string> {
  const isPath = fileOrPath.includes('/')
  const arg = isPath ? `path=${fileOrPath}` : `file=${fileOrPath}`
  const { stdout } = await exec(getCliPath(), ['delete', arg, ...vaultArg()])
  return stdout
}

export async function listVaults(): Promise<VaultInfo[]> {
  const { stdout } = await exec(getCliPath(), ['vaults', 'verbose', 'format=json'])
  return JSON.parse(stdout) as VaultInfo[]
}

export async function listTasks(folder?: string): Promise<string> {
  const args = ['tasks']
  if (folder) args.push(`path=${folder}`)
  args.push('format=json', ...vaultArg())
  const { stdout } = await exec(getCliPath(), args)
  return stdout
}

export async function runObsidianCommand(commandId: string): Promise<string> {
  const { stdout } = await exec(getCliPath(), ['command', `id=${commandId}`, ...vaultArg()])
  return stdout
}
```

Wait — `execa` is not installed. Let me use Node's built-in `child_process` instead. Fix:

```typescript
import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)

function getCliPath(): string {
  return process.env.OBSIDIAN_CLI_PATH || '/usr/local/bin/obsidian'
}

function getVault(): string {
  return process.env.OBSIDIAN_VAULT || ''
}

function vaultFlag(): string[] {
  const v = getVault()
  return v ? [`vault=${v}`] : []
}

export interface Note {
  name: string
  path: string
  content?: string
}

export interface SearchResult {
  file: string
  line: number
  content: string
}

export interface VaultInfo {
  name: string
  path: string
  files: number
  folders: number
  size: number
}

export async function readNote(fileOrPath: string): Promise<string> {
  const isPath = fileOrPath.includes('/')
  const arg = isPath ? `path=${fileOrPath}` : `file=${fileOrPath}`
  const { stdout } = await exec(getCliPath(), ['read', arg, ...vaultFlag()])
  return stdout
}

export async function writeNote(name: string, content: string): Promise<string> {
  const { stdout } = await exec(getCliPath(), [
    'create', `name=${name}`, `content=${content}`, 'overwrite', ...vaultFlag(),
  ])
  return stdout
}

export async function searchVault(query: string, folder?: string): Promise<SearchResult[]> {
  const args = ['search:context', `query=${query}`]
  if (folder) args.push(`path=${folder}`)
  args.push('format=json', ...vaultFlag())
  const { stdout } = await exec(getCliPath(), args)
  return JSON.parse(stdout) as SearchResult[]
}

export async function listNotes(folder?: string): Promise<string[]> {
  const args = ['files']
  if (folder) args.push(`folder=${folder}`)
  args.push(...vaultFlag())
  const { stdout } = await exec(getCliPath(), args)
  return stdout.split('\n').filter(Boolean)
}

export async function appendNote(fileOrPath: string, content: string): Promise<string> {
  const isPath = fileOrPath.includes('/')
  const arg = isPath ? `path=${fileOrPath}` : `file=${fileOrPath}`
  const { stdout } = await exec(getCliPath(), ['append', arg, `content=${content}`, ...vaultFlag()])
  return stdout
}

export async function deleteNote(fileOrPath: string): Promise<string> {
  const isPath = fileOrPath.includes('/')
  const arg = isPath ? `path=${fileOrPath}` : `file=${fileOrPath}`
  const { stdout } = await exec(getCliPath(), ['delete', arg, ...vaultFlag()])
  return stdout
}

export async function listVaults(): Promise<string> {
  const { stdout } = await exec(getCliPath(), ['vaults', 'verbose'])
  return stdout
}

export async function listTasks(): Promise<string> {
  const { stdout } = await exec(getCliPath(), ['tasks', 'format=json', ...vaultFlag()])
  return stdout
}

export async function runObsidianCommand(commandId: string): Promise<string> {
  const { stdout } = await exec(getCliPath(), ['command', `id=${commandId}`, ...vaultFlag()])
  return stdout
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `cd /Users/david/Documents/Code/budgeting\ app/obsidian-mcp && npx tsc --noEmit`
Expected: No type errors

---

### Task 3: Build the MCP server entry point

**Files:**
- Create: `/Users/david/Documents/Code/budgeting app/obsidian-mcp/src/index.ts`

- [ ] **Step 1: Create the MCP server with all tools**

```typescript
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js'
import * as obsidian from './obsidian.js'

const server = new Server(
  {
    name: 'obsidian-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_note',
      description: 'Read the contents of a note from the Obsidian vault',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Note name (like wikilinks) or path (folder/note.md)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'write_note',
      description: 'Create or overwrite a note in the Obsidian vault',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name or path (e.g. opencode/memories/foo)' },
          content: { type: 'string', description: 'Markdown content of the note' },
        },
        required: ['name', 'content'],
      },
    },
    {
      name: 'search_notes',
      description: 'Full-text search across the Obsidian vault',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          folder: { type: 'string', description: 'Optional folder to scope search to' },
        },
        required: ['query'],
      },
    },
    {
      name: 'list_notes',
      description: 'List files in a vault folder',
      inputSchema: {
        type: 'object',
        properties: {
          folder: { type: 'string', description: 'Folder path (e.g. opencode/memories). Root if omitted' },
        },
      },
    },
    {
      name: 'append_to_note',
      description: 'Append content to an existing note',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Note name or path' },
          content: { type: 'string', description: 'Content to append' },
        },
        required: ['name', 'content'],
      },
    },
    {
      name: 'delete_note',
      description: 'Delete a note from the vault',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Note name or path to delete' },
        },
        required: ['name'],
      },
    },
    {
      name: 'list_vaults',
      description: 'List all Obsidian vaults',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'list_tasks',
      description: 'List tasks in the vault',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'run_command',
      description: 'Execute any Obsidian command by ID',
      inputSchema: {
        type: 'object',
        properties: {
          commandId: { type: 'string', description: 'Obsidian command ID (e.g. app:open-open-command)' },
        },
        required: ['commandId'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'read_note': {
        const content = await obsidian.readNote(String(args?.name))
        return { content: [{ type: 'text', text: content }] }
      }

      case 'write_note': {
        const result = await obsidian.writeNote(String(args?.name), String(args?.content))
        return { content: [{ type: 'text', text: result || `Note "${args?.name}" written successfully` }] }
      }

      case 'search_notes': {
        const results = await obsidian.searchVault(
          String(args?.query),
          args?.folder ? String(args.folder) : undefined,
        )
        const text = results.map(r => `${r.file}:${r.line} — ${r.content}`).join('\n')
        return { content: [{ type: 'text', text: text || 'No results found' }] }
      }

      case 'list_notes': {
        const files = await obsidian.listNotes(args?.folder ? String(args.folder) : undefined)
        return { content: [{ type: 'text', text: files.join('\n') || '(empty folder)' }] }
      }

      case 'append_to_note': {
        const result = await obsidian.appendNote(String(args?.name), String(args?.content))
        return { content: [{ type: 'text', text: result || 'Content appended' }] }
      }

      case 'delete_note': {
        const result = await obsidian.deleteNote(String(args?.name))
        return { content: [{ type: 'text', text: result || 'Note deleted' }] }
      }

      case 'list_vaults': {
        const result = await obsidian.listVaults()
        return { content: [{ type: 'text', text: result }] }
      }

      case 'list_tasks': {
        const result = await obsidian.listTasks()
        return { content: [{ type: 'text', text: result }] }
      }

      case 'run_command': {
        const result = await obsidian.runObsidianCommand(String(args?.commandId))
        return { content: [{ type: 'text', text: result }] }
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
    }
  } catch (error: any) {
    throw new McpError(ErrorCode.InternalError, `Obsidian error: ${error.message}`)
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Obsidian MCP server running on stdio')
}

main().catch(console.error)
```

- [ ] **Step 2: Compile the TypeScript**

Run:
```bash
cd /Users/david/Documents/Code/budgeting\ app/obsidian-mcp
npx tsc
```
Expected: `dist/index.js` and `dist/obsidian.js` created with no errors.

---

### Task 4: Create the agent memory folder structure in Obsidian

- [ ] **Step 1: Create the agent memory folders in Second-Brain vault**

```bash
# Create the opencode folder structure
obsidian vault=Second-Brain create name=opencode/.keep content=""
obsidian vault=Second-Brain create name=opencode/agents/.keep content=""
obsidian vault=Second-Brain create name=opencode/memories/.keep content=""
obsidian vault=Second-Brain create name=opencode/plans/.keep content=""
obsidian vault=Second-Brain create name=opencode/specs/.keep content=""
obsidian vault=Second-Brain create name=opencode/logs/.keep content=""
```

- [ ] **Step 2: Create the initial memory context note**

```bash
obsidian vault=Second-Brain create name="opencode/memories/budgeting-context" content="---
type: memory
project: clearr-budgeting
status: active
tags: [opencode, budgeting, supabase]
---

# Clearr Budgeting — Project Context

**Tech Stack:** Vanilla JS, Vite, Supabase (auth + DB), Capacitor (mobile), Vercel

**Key Files:**
- \`src/main.js\` — Entry point
- \`src/db.js\` — Supabase data layer (transactions, preferences, onboarding)
- \`src/supabase.js\` — Supabase client with encrypted storage
- \`index.html\` — All UI screens
- \`styles.css\` — All styles
- \`script.js\` — All UI logic

**Current State:** Core app is built and functional. Next priorities are:
1. Obsidian-OpenCode MCP server (this project)
2. Budgeting app features TBD"
```

---

### Task 5: Register MCP server in OpenCode config

**Files:**
- Modify: `/Users/david/.config/opencode/opencode.jsonc`

- [ ] **Step 1: Add the MCP server to OpenCode config**

Edit `/Users/david/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["superpowers@git+https://github.com/obra/superpowers.git"],
  "skills": {
    "paths": ["~/.config/opencode/skills"]
  },
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/Users/david/Documents/Code/budgeting app/obsidian-mcp/dist/index.js"],
      "env": {
        "OBSIDIAN_VAULT": "Second-Brain",
        "OBSIDIAN_CLI_PATH": "/usr/local/bin/obsidian"
      }
    }
  }
}
```

---

### Task 6: Manual verification

- [ ] **Step 1: Test the MCP server starts correctly**

```bash
node /Users/david/Documents/Code/budgeting\ app/obsidian-mcp/dist/index.js
```
Expected: Prints "Obsidian MCP server running on stdio" to stderr, waits on stdin.

Press Ctrl+C to stop.

- [ ] **Step 2: Test with a JSON-RPC ping**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node /Users/david/Documents/Code/budgeting\ app/obsidian-mcp/dist/index.js
```
Expected: Returns a JSON-RPC response listing all 9 tools.

- [ ] **Step 3: Test reading the budgeting context note**

```bash
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"read_note","arguments":{"name":"opencode/memories/budgeting-context"}}}' | node /Users/david/Documents/Code/budgeting\ app/obsidian-mcp/dist/index.js
```
Expected: Returns the markdown content of the budgeting context note.
