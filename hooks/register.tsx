import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SkillRow } from '../types'

const PANE = 'skill-library'
const skills = atom({ plugin: 'skill-library', key: 'skills' } as const, [])
const selected = atom({ plugin: 'skill-library', key: 'selected' } as const, null)
const query = atom({ plugin: 'skill-library', key: 'query' } as const, '')

// Your own skills first, built-ins last.
const ORDER = ['userSettings', 'projectSettings', 'plugin', 'syncedSkills', 'mcp', 'built-in']

// Name prefixes that mark a family of skills from one author.
const FAMILIES: Record<string, string> = {
  gws: 'Google Workspace',
  hyperframes: 'HyperFrames',
  ponytail: 'Ponytail',
  hairline: 'Hairline',
}

const COLUMNS = { name: 34, set: 20 }

// One line of a SKILL.md's frontmatter, quotes removed.
const front = (text: string, key: string): string | undefined => {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const line = new RegExp(`^${key}:\s*(.*)$`, 'm').exec(head)?.[1]?.trim()

  return line ? line.replace(/^["']|["']$/g, '') : undefined
}

const firstUrl = (text: string): string | undefined =>
  /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.exec(text)?.[0]

const rank = (source: string) => {
  const i = ORDER.indexOf(source)

  return i < 0 ? ORDER.length : i
}

async function load($: EngineInterface) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const listed = usage.context.breakdown?.skills?.skillFrontmatter ?? []
  const home = await $.env.get('USERPROFILE')
  const base = home ? `${home}/.claude/skills` : undefined

  // Matt Pocock's skills are the ones his router skill points to.
  const router = base ? await $.fs.read(`${base}/ask-matt/SKILL.md`).catch(() => undefined) : undefined
  const matt = new Set<string>(
    typeof router === 'string' ? [...router.matchAll(/`\/([a-z0-9-]+)`/g)].map(m => m[1]) : [],
  )
  if (typeof router === 'string') {
    matt.add('ask-matt')
  }

  const rows: SkillRow[] = []
  for (const one of listed) {
    const prefix = one.name.split(/[-:]/)[0]
    const set = one.pluginName ?? (matt.has(one.name) ? 'Matt Pocock' : (FAMILIES[prefix] ?? ''))
    const row: SkillRow = { name: one.name, source: one.source, set: one.source === 'built-in' ? 'built-in' : set }

    if (one.source === 'userSettings' && base) {
      const path = `${base}/${one.name}/SKILL.md`
      const text = await $.fs.read(path).catch(() => undefined)
      if (typeof text === 'string') {
        row.path = path
        row.description = front(text, 'description')
        row.link = front(text, 'homepage') ?? front(text, 'repository') ?? firstUrl(text)
        if (!row.link) {
          const readme = await $.fs.read(`${base}/${one.name}/README.md`).catch(() => undefined)
          row.link = typeof readme === 'string' ? firstUrl(readme) : undefined
        }
      }
    }
    rows.push(row)
  }
  rows.sort(
    (a, b) =>
      rank(a.source) - rank(b.source) ||
      (a.set === '' ? 1 : 0) - (b.set === '' ? 1 : 0) ||
      a.set.localeCompare(b.set) ||
      a.name.localeCompare(b.name),
  )
  await update($, skills, () => rows)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'library',
      description: 'Open the skill library pane (browse installed skills)',
    })

    return next(e)
  })

  on('command.run', { command: 'library' }, async $ => {
    await load($)
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'Skill library' })

    return {
      text: isPlaced
        ? 'Skill library opened. Invoke any skill by typing /<skill-name>.'
        : 'This screen cannot draw mod panes, so the Skill library has nowhere to show.',
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Link } = $.ui.resolve(e)
    const all = await read($, skills)
    const pick = await read($, selected)
    const typed = await read($, query)
    const q = typed.trim().toLowerCase()
    const list = q
      ? all.filter(s => `${s.name} ${s.set} ${s.description ?? ''}`.toLowerCase().includes(q))
      : all

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>{q ? `${list.length} of ${all.length}` : all.length} skills </Text>
          <Button key="refresh" label="Refresh" onPress={() => load($)} />
        </Box>
        <Text dimColor>Click a skill to read it. Invoke any skill by typing /name in the prompt.</Text>
        <Input
          key="search"
          label="Search: "
          placeholder="name, skillset or description"
          value={typed}
          submitLabel="search"
          onInput={value => {
            void update($, query, () => value)
          }}
          onSubmit={() => {}}
        />
        <Box>
          <Box width={COLUMNS.name}>
            <Text bold>Skill</Text>
          </Box>
          <Box width={COLUMNS.set}>
            <Text bold>Skillset</Text>
          </Box>
          <Text bold>Link</Text>
        </Box>
        {list.length === 0 && (
          <Text dimColor>{all.length === 0 ? 'No skills loaded. Press Refresh.' : 'No match.'}</Text>
        )}
        {list.map(s => (
          <Box key={s.name} flexDirection="column">
            <Box>
              <Box width={COLUMNS.name}>
                <Button
                  key={s.name}
                  label={`/${s.name}`}
                  onPress={() => update($, selected, () => (pick === s.name ? null : s.name))}
                />
              </Box>
              <Box width={COLUMNS.set}>
                <Text dimColor={s.set === ''} wrap="truncate">
                  {s.set === '' ? '-' : s.set}
                </Text>
              </Box>
              {s.link ? <Link href={s.link} label="repo" /> : <Text dimColor>-</Text>}
            </Box>
            {pick === s.name && (
              <Box flexDirection="column" borderStyle="round">
                <Text bold>Invoke: /{s.name}</Text>
                <Text>{s.description ?? 'No description available for this source.'}</Text>
                <Text dimColor>
                  {s.set === '' ? 'Standalone skill' : `Part of: ${s.set}`}
                  {s.path ? `  |  ${s.path}` : ''}
                </Text>
                {s.link && <Link href={s.link} />}
              </Box>
            )}
          </Box>
        ))}
      </Box>
    )
  })
}
