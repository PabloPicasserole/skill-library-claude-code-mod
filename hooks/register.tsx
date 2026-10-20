import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SkillRow } from '../types'

const PANE = 'skill-library'
const skills = atom({ plugin: 'skill-library', key: 'skills' } as const, [])
const selected = atom({ plugin: 'skill-library', key: 'selected' } as const, null)
const query = atom({ plugin: 'skill-library', key: 'query' } as const, '')
const offset = atom({ plugin: 'skill-library', key: 'offset' } as const, 0)
const sort = atom({ plugin: 'skill-library', key: 'sort' } as const, { col: 'default', dir: 'asc' })

type Col = 'name' | 'set' | 'link'

// The text a column sorts on; an empty value always sorts last.
const cell = (s: SkillRow, col: Col): string =>
  col === 'name' ? s.name : col === 'set' ? s.set : (s.link ?? '')

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
  const line = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(head)?.[1]?.trim()

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

// Rows the pinned header takes: the count line, the hint, the search, its padding, the column heads.
const HEADER_ROWS = 5
// Rows kept free for an open detail card.
const CARD_ROWS = 12

type Order = { col: string; dir: string }

// The skills matching the search, in the order the column heads ask for.
const arrange = (all: SkillRow[], typed: string, order: Order): SkillRow[] => {
  const q = typed.trim().toLowerCase()
  const found = q
    ? all.filter(s => `${s.name} ${s.set} ${s.description ?? ''}`.toLowerCase().includes(q))
    : all
  if (order.col === 'default') {
    return found
  }

  return [...found].sort((a, b) => {
    const x = cell(a, order.col as Col)
    const y = cell(b, order.col as Col)
    if (x === '' || y === '') {
      return (x === '' ? 1 : 0) - (y === '' ? 1 : 0)
    }

    return (order.dir === 'asc' ? 1 : -1) * x.localeCompare(y)
  })
}

// How many skill rows fit under the header (less the card, when one is open).
const roomFor = (bodyRows: number, hasCard: boolean): number =>
  Math.max(3, bodyRows - HEADER_ROWS - (hasCard ? CARD_ROWS : 0))

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

  // The pane scrolls its own rows, so the header above them stays put: the
  // wheel and the scroll keys move `offset`, and the engine's window stays at 0.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = arrange(await read($, skills), await read($, query), await read($, sort))
    const room = roomFor(e.bodyRows, (await read($, selected)) !== null)
    const last = Math.max(0, list.length - room)
    await update($, offset, cur => Math.max(0, Math.min(Math.min(cur, last) + e.by, last)))

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input, Link } = $.ui.resolve(e)
    const all = await read($, skills)
    const pick = await read($, selected)
    const typed = await read($, query)
    const order = await read($, sort)
    const list = arrange(all, typed, order)
    const room = roomFor(e.props.scroll.bodyRows, pick !== null)
    const top = Math.min(await read($, offset), Math.max(0, list.length - room))
    const shown = list.slice(top, top + room)
    // First click sorts ascending, second descending, third back to the default order.
    const press = (col: Col) => {
      void update($, offset, () => 0)
      void update($, sort, cur =>
        cur.col !== col
          ? { col, dir: 'asc' }
          : cur.dir === 'asc'
            ? { col, dir: 'desc' }
            : { col: 'default', dir: 'asc' },
      )
    }
    const head = (col: Col, label: string) =>
      order.col === col ? `${label} ${order.dir === 'asc' ? '^' : 'v'}` : label

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>
            {typed.trim() ? `${list.length} of ${all.length}` : all.length} skills
            {list.length > room ? ` (${top + 1}-${top + shown.length})` : ''}{' '}
          </Text>
          <Button key="refresh" label="Refresh" onPress={() => load($)} />
        </Box>
        <Text dimColor>Click a skill to read it. Invoke any skill by typing /name in the prompt.</Text>
        <Box marginBottom={1}>
          <Input
            key="search"
            label="Search: "
            placeholder="name, skillset or description"
            value={typed}
            submitLabel="search"
            onInput={value => {
              void update($, query, () => value)
              void update($, offset, () => 0)
            }}
            onSubmit={() => {}}
          />
        </Box>
        <Box>
          <Box width={COLUMNS.name}>
            <Button key="sort:name" label={head('name', 'Skill')} onPress={() => press('name')} />
          </Box>
          <Box width={COLUMNS.set}>
            <Button key="sort:set" label={head('set', 'Skillset')} onPress={() => press('set')} />
          </Box>
          <Button key="sort:link" label={head('link', 'Link')} onPress={() => press('link')} />
        </Box>
        {list.length === 0 && (
          <Text dimColor>{all.length === 0 ? 'No skills loaded. Press Refresh.' : 'No match.'}</Text>
        )}
        {shown.map(s => (
          <Box key={`row:${s.name}`} flexDirection="column">
            <Box>
              <Box width={COLUMNS.name}>
                <Button
                  key={`open:${s.name}`}
                  label={`/${s.name}`}
                  onPress={() => update($, selected, cur => (cur === s.name ? null : s.name))}
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
