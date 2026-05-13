import { ScriptSchema } from './types'
import type { Script } from './types'

const rawScripts: Array<{ path: string; data: unknown }> = [
  {
    path: 'trip-planning-v1.json',
    data: {
      id: 'trip-planning-v1',
      title: 'Trip planning — preferences emerge over turns',
      mode: 'scientist',
      activeEngine: 'hindsight',
      options: {
        interTurnDelayMs: 800,
        waitForSnapshot: true,
      },
      turns: [
        {
          user: "I'm planning a 5-day trip and I want help thinking through it.",
        },
        {
          user: 'I have a really hard time with humid heat. Anything over 80°F with humidity is a nightmare for me.',
        },
        {
          user: 'Also, I love mountains. Coastal cities are fine but mountains are the priority.',
        },
        { user: 'Given all that, what would you suggest for late June?' },
        {
          user: "Cool. Now if I told you my partner has a peanut allergy and we're vegetarian, does that change your recommendation?",
        },
      ],
    },
  },
  {
    path: 'preference-contradictions-v1.json',
    data: {
      id: 'preference-contradictions-v1',
      title: 'Stated preference contradicts later behavior',
      mode: 'scientist',
      activeEngine: 'hindsight',
      options: {
        interTurnDelayMs: 800,
        waitForSnapshot: true,
      },
      turns: [
        {
          user: 'I really value getting up early. 6am is my ideal start time.',
        },
        { user: "What's a good morning routine?" },
        {
          user: "Actually scratch that — I've been sleeping until 10am every day this week. Maybe I'm not actually a morning person.",
        },
        { user: 'So what kind of routine should I have?' },
        {
          user: 'Be honest — based on what you know about me, what AM I, morning person or not?',
        },
      ],
    },
  },
]

const scripts: Array<Script> = rawScripts
  .map(({ path, data }) => {
    const parsed = ScriptSchema.safeParse(data)
    if (!parsed.success) {
      console.error(
        `[scripts] invalid script at ${path}:`,
        parsed.error.flatten(),
      )
      return null
    }
    return parsed.data
  })
  .filter((s): s is Script => s !== null)

export function listScripts(): Array<Script> {
  return scripts
}

export function getScriptById(id: string): Script | undefined {
  return scripts.find((s) => s.id === id)
}
