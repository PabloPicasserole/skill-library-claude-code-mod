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

// The pane draws its own window of rows so the header above them stays put.
// Sizes are in the engine's cells; a graphical surface draws a button row taller
// than one cell, so each row is counted as ROW_CELLS.
const HEADER_CELLS = 8
const ROW_CELLS = 1.3
// Cells one scroll-bar arrow takes.
const ARROW_CELLS = 1.3
// Cells kept free for an open description when working out where the list ends.
const CARD_RESERVE = 10

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

// Cells the list may use: the body less the pinned header.
const spaceFor = (bodyRows: number): number => Math.max(6, Math.floor(bodyRows - HEADER_CELLS))

// The text of an open skill, as lines of at most `width` characters.
const detail = (s: SkillRow): string[] => [
  s.description ?? 'No description available for this source.',
  `${s.set === '' ? 'Standalone skill' : `Part of: ${s.set}`}${s.path ? `  |  ${s.path}` : ''}`,
]

// Cells an open skill's description takes under its row.
const cardCells = (s: SkillRow, columns: number): number => {
  const width = Math.max(20, columns - 2)

  return 2 + detail(s).reduce((n, text) => n + Math.max(1, Math.ceil(text.length / width)), 0) + (s.link ? 1 : 0)
}

// The furthest the list may scroll: the first row from which the rest still fit.
const lastOffset = (count: number, space: number, hasCard: boolean): number => {
  let used = hasCard ? CARD_RESERVE : 0
  let fit = 0
  while (fit < count && used + ROW_CELLS <= space) {
    used += ROW_CELLS
    fit += 1
  }

  return Math.max(0, count - Math.max(1, fit))
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

  // The wheel and the scroll keys move `offset`; the engine's own window stays at 0.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = arrange(await read($, skills), await read($, query), await read($, sort))
    const last = lastOffset(list.length, spaceFor(e.bodyRows), (await read($, selected)) !== null)
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
    const space = spaceFor(e.props.scroll.bodyRows)
    const columns = e.props.bodyColumns
    const top = Math.min(await read($, offset), lastOffset(list.length, space, pick !== null))

    // Take rows from `top` until the space is used; an open description counts too.
    const shown: SkillRow[] = []
    let used = 0
    for (const s of list.slice(top)) {
      const cost = ROW_CELLS + (s.name === pick ? cardCells(s, columns) : 0)
      if (shown.length > 0 && used + cost > space) {
        break
      }
      shown.push(s)
      used += cost
    }

    // A scroll bar: one line per cell of the window, the thumb where the window is.
    // The arrows at its ends are Buttons, the only element a click can press; each takes
    // about ARROW_CELLS of the height, the track gets the rest.
    const lines = Math.max(1, Math.floor(space - 2 * ARROW_CELLS))
    const size = list.length === 0 ? lines : Math.max(1, Math.round((shown.length / list.length) * lines))
    const start =
      list.length <= shown.length ? 0 : Math.round((top / (list.length - shown.length)) * (lines - size))
    const last = lastOffset(list.length, space, pick !== null)
    // A click moves a page, less one row so the eye keeps its place.
    const page = (by: number) =>
      update($, offset, cur => Math.max(0, Math.min(Math.min(cur, last) + by, last)))
    const step = Math.max(1, shown.length - 1)

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
            {list.length > shown.length ? ` (${top + 1}-${top + shown.length})` : ''}{' '}
          </Text>
          <Button key="refresh" label="Refresh" onPress={() => load($)} />
        </Box>
        <Text dimColor>Click a skill to read it. Scroll with the wheel or arrow keys.</Text>
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
        <Box height={space} overflow="hidden">
          <Box flexDirection="column" flexGrow={1}>
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
                  <Box flexDirection="column" paddingLeft={1} paddingY={1}>
                    <Text bold>Invoke: /{s.name}</Text>
                    <Text>{detail(s)[0]}</Text>
                    <Text dimColor>{detail(s)[1]}</Text>
                    {s.link && <Link href={s.link} />}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
          {list.length > shown.length && (
            <Box marginLeft={1} flexDirection="column">
              <Button key="page:up" label="▲" onPress={() => page(-step)} />
              <Box width={1} height={lines} flexDirection="column" backgroundColor="#444444">
                <Box marginTop={start} height={size} backgroundColor="#9a9a9a" />
              </Box>
              <Button key="page:down" label="▼" onPress={() => page(step)} />
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
