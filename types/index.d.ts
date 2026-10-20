export type SkillRow = {
  name: string
  source: string
  /** The skillset it belongs to: a plugin, a family or "Matt Pocock"; empty when standalone. */
  set: string
  description?: string
  path?: string
  /** A web page for the skill (its repo or readme), when it ships one. */
  link?: string
}

declare module 'claude-code' {
  interface PluginState {
    'skill-library': {
      skills: SkillRow[]
      selected: string | null
      query: string
      offset: number
      sort: { col: string; dir: string }
    }
  }
}
