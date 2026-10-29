import type { Context as ClientContext } from '@deepseek-ai/cordis'

interface LayoutSeat { selectPanel(panelId: string): void }
interface SlotSeat { inject(name: string, factory: () => unknown): void }

/** Fail loud when the injected client seats are absent, instead of leaving a PENDING row. */
export function requireHealthSeats(ctx: ClientContext): void {
  const seats = ctx as ClientContext & { slots?: SlotSeat }
  if (seats.slots === undefined) throw new Error('skill-health: the client slots seat is not mounted')
}

/** The one place the panel crosses into the platform layout seat. */
export function openSkillHistory(ctx: ClientContext): void {
  const layout = (ctx as ClientContext & { layout: LayoutSeat }).layout
  layout.selectPanel('skill-history')
}
