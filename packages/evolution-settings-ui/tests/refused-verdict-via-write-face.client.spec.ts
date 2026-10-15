// @tier pre-tag
// @vitest-environment jsdom
// G4/4.1 (second half): the refused-write verdict must survive the SAME test when the write goes
// through the family section OWN write face instead of an injected mutate.
//
// The Plugins-page spec (refused-verdict.client.spec.ts) hands the card a bare `mutate` function, so
// it never touches writeFaceFor. The section builds its form through writeFaceFor(probe, namespace)
// (index.ts:146) - and that wrapper used to answer a CONSTANT true, which turned every refusal into
// an accepted write on that path only. Copying the drill here is what the plan asks for; it is a
// regression guard now that the wrapper forwards the verdict.
import { describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render } from "@testing-library/react"
import { createElement } from "react"
import { CLIENT_PARAM_SECTIONS } from "../src/client/generated-params.ts"
import { formatText, type MessageKey } from "../src/client/messages.ts"
import { RowConfigCard } from "../src/client/RowConfigCard.ts"
import { writeFaceFor } from "../src/client/source.ts"

const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string => formatText(key, values)
const section = CLIENT_PARAM_SECTIONS.find(candidate => candidate.namespace === "memory-files")
if (section === undefined) throw new Error("the generated view lost the memory-files row")
const fields = section.fields
const FIELD = fields.find(field => field.control === "number")
if (FIELD === undefined) throw new Error("the memory-files row lost its numeric fields")
const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]

function state(user: Record<string, unknown>) {
  return { status: "ready", value: { ...user }, base: undefined, user, revision: 7, writable: true, mode: "host" }
}
/** The section path: the card write face comes from writeFaceFor, over a seat stub with this verdict. */
const seat = (verdict: boolean) => ({
  getSnapshot: () => ({ status: "ready" }),
  subscribe: () => () => {},
  set: async () => verdict,
  unset: async () => verdict,
  mutate: async () => verdict,
})
function viaWriteFace(verdict: boolean, user: Record<string, unknown>) {
  const probe = (() => ({ get: () => seat(verdict) })) as unknown as Parameters<typeof writeFaceFor>[0]
  const face = writeFaceFor(probe, "memory-files")
  return h(RowConfigCard, { namespace: "memory-files", fields, t, view: "page", form: { state: state(user), mutate: face.mutateOnce } })
}
const save = async (view: { container: Element }) => {
  fireEvent.click(view.container.querySelector(".evolution-param-head") as Element)
  const input = view.container.querySelector("#" + "evolution-param-" + FIELD!.id) as HTMLInputElement
  fireEvent.change(input, { target: { value: " 321 " } })
  fireEvent.click(view.container.querySelector("[data-primary='true']") as Element)
}

describe("G4/4.1: the own-section write face reports the seat verdict", () => {
  it("reports a refused save even when the user layer already holds the requested value", async () => {
    const view = render(viaWriteFace(false, { [FIELD!.id]: 321 }))
    await save(view as unknown as { container: Element })
    await vi.waitFor(() => { expect(view.container.textContent).toContain(t("refused")) })
    cleanup()
  })

  it("forwards an accepted write (no refusal line)", async () => {
    const view = render(viaWriteFace(true, {}))
    await save(view as unknown as { container: Element })
    await vi.waitFor(() => { expect(view.container.textContent).not.toContain(t("refused")) })
    cleanup()
  })
})
