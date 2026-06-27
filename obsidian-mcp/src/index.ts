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
        const text = results.flatMap(r =>
          r.matches.map(m => `${r.file}:${m.line} — ${m.text}`)
        ).join('\n')
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
