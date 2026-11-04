import type { Context as ClientContext } from '@deepseek-ai/cordis'

interface SlotSeat { inject(name: string, factory: () => unknown): void }

/** Fail loud when the injected client seats are absent, instead of leaving a PENDING row. */
export function requireHealthSeats(ctx: ClientContext): void {
  const seats = ctx as ClientContext & { slots?: SlotSeat }
  if (seats.slots === undefined) throw new Error('skill-health: the client slots seat is not mounted')
}
