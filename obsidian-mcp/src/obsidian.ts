import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)

function getCliPath(): string {
  return process.env.OBSIDIAN_CLI_PATH ?? '/usr/local/bin/obsidian'
}

function getVault(): string {
  return process.env.OBSIDIAN_VAULT ?? 'Second-Brain'
}

function resolveArg(fileOrPath: string): string {
  // Obsidian CLI: file= uses wikilink lookup (name without extension).
  // More reliable than path= which requires exact extension match.
  const name = fileOrPath.includes('/') ? fileOrPath.split('/').pop()! : fileOrPath
  return `file=${name}`
}

export interface SearchMatch {
  line: number
  text: string
}

export interface SearchResult {
  file: string
  matches: SearchMatch[]
}

export async function readNote(fileOrPath: string): Promise<string> {
  const { stdout } = await exec(getCliPath(), [
    'read', resolveArg(fileOrPath), `vault=${getVault()}`,
  ])
  return stdout
}

export async function writeNote(name: string, content: string): Promise<string> {
  const { stdout } = await exec(getCliPath(), [
    'create', `name=${name}`, `content=${content}`, 'overwrite', `vault=${getVault()}`,
  ])
  return stdout
}

export async function searchVault(query: string, folder?: string): Promise<SearchResult[]> {
  const args = ['search:context', `query=${query}`, 'format=json', `vault=${getVault()}`]
  if (folder) args.push(`path=${folder}`)
  const { stdout } = await exec(getCliPath(), args)
  return JSON.parse(stdout) as SearchResult[]
}

export async function listNotes(folder?: string): Promise<string[]> {
  const args = ['files', `vault=${getVault()}`]
  if (folder) args.push(`folder=${folder}`)
  const { stdout } = await exec(getCliPath(), args)
  return stdout.split('\n').filter(Boolean)
}

export async function appendNote(fileOrPath: string, content: string): Promise<string> {
  const { stdout } = await exec(getCliPath(), [
    'append', resolveArg(fileOrPath), `content=${content}`, `vault=${getVault()}`,
  ])
  return stdout
}

export async function deleteNote(fileOrPath: string): Promise<string> {
  const { stdout } = await exec(getCliPath(), [
    'delete', resolveArg(fileOrPath), `vault=${getVault()}`,
  ])
  return stdout
}

export async function listVaults(): Promise<string> {
  const { stdout } = await exec(getCliPath(), ['vaults', 'verbose'])
  return stdout
}

export async function listTasks(): Promise<string> {
  const { stdout } = await exec(getCliPath(), ['tasks', 'format=json', `vault=${getVault()}`])
  return stdout
}

export async function runObsidianCommand(commandId: string): Promise<string> {
  const { stdout } = await exec(getCliPath(), ['command', `id=${commandId}`, `vault=${getVault()}`])
  return stdout
}
