# Skill Library (a Claude Code mod)

A pane that shows every skill your Claude Code session has, as a searchable table.

- **Skill**: the name. Click it to open its full description, how to invoke it (`/name`), and its file path.
- **Skillset**: the larger set it belongs to (a plugin, or a family such as Google Workspace or HyperFrames), or `-` if it stands alone.
- **Link**: a `repo` link when the skill ships with a GitHub URL in its metadata or README.
- A search box filters by name, skillset or description.
- Click a column heading to sort by it (click again for descending, a third time to reset).
- The header (count, search, column headings) stays pinned. Scroll the list with the mouse wheel, the arrow, Page Up/Down, Home and End keys, or the Up / Down / Page buttons.

Your own skills are listed first, then plugin skills, then built-ins.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install skill-library --marketplace PabloPicasserole/skill-library-claude-code-mod
```

From a shell:

```
claude plugin install skill-library --marketplace PabloPicasserole/skill-library-claude-code-mod
```

Answer `y` to add the marketplace, then pick a scope.

## Use

Type `/library` to open the pane.

## Known limits (first version)

- Descriptions and links only show for skills in your own `~/.claude/skills` folder. For plugin and built-in skills the engine only gives a name and source.
- Skillsets are guessed: plugin skills use the plugin's name; skills named by Matt Pocock's `ask-matt` router show as "Matt Pocock" (only if you have that skill); a few name prefixes (`gws-`, `hyperframes`, `ponytail`, `hairline`) are grouped as families. Everything else is shown as standalone. Edit `FAMILIES` in `hooks/register.tsx` to add your own.
- It reads skills from the Windows user profile (`USERPROFILE`), so it has only been tried on Windows.
- The row height is tuned to the desktop app. A different screen scale may leave a little blank space or clip a row.
- Mods and the pane API are new; this has been tested only on the author's machine.

## License

MIT
