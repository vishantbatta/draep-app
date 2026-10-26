/**
 * SSE plumbing for /auto-design/analyze-stream — the reader must survive
 * chunk boundaries landing anywhere (mid-line, mid-frame), multi-line data,
 * and a stream that ends without a terminal event.
 */
import { describe, expect, it } from "vitest";

import { readSseEvents, type SseEvent } from "../api/autoDesign";

function streamOf(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

async function collect(chunks: string[]): Promise<SseEvent[]> {
  const out: SseEvent[] = [];
  await readSseEvents(streamOf(chunks), (e) => out.push(e));
  return out;
}

describe("readSseEvents", () => {
  it("parses whole frames into named events with JSON data", async () => {
    const events = await collect([
      'event: stage\ndata: {"step":"garment","status":"start","label":"Garment"}\n\n',
      'event: done\ndata: {"garment_id":"g","selections":[],"addons":[],"missing_critical":[]}\n\n',
    ]);
    expect(events).toEqual([
      { name: "stage", data: { step: "garment", status: "start", label: "Garment" } },
      { name: "done", data: { garment_id: "g", selections: [], addons: [], missing_critical: [] } },
    ]);
  });

  it("reassembles frames split across arbitrary chunk boundaries", async () => {
    const frame = 'event: stage\ndata: {"step":"component","status":"done","component_id":"c-1","label":"Front neck","picked":{"label":"Deep · V"}}\n\n';
    const split = [frame.slice(0, 9), frame.slice(9, 40), frame.slice(40, 41), frame.slice(41)];
    const events = await collect(split);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("stage");
    expect((events[0].data as { picked: { label: string } }).picked.label).toBe("Deep · V");
  });

  it("joins multi-line data and defaults the event name to message", async () => {
    const events = await collect(['data: {"a":\ndata: 1}\n\n']);
    expect(events).toEqual([{ name: "message", data: { a: 1 } }]);
  });

  it("ignores comments, blank keep-alives and frames with no data", async () => {
    const events = await collect([": keep-alive\n\n", "event: ping\n\n", 'event: x\ndata: {"ok":true}\n\n']);
    expect(events).toEqual([{ name: "x", data: { ok: true } }]);
  });

  it("flushes a final frame that arrives without the trailing blank line", async () => {
    const events = await collect(['event: done\ndata: {"garment_id":"g"}']);
    expect(events).toEqual([{ name: "done", data: { garment_id: "g" } }]);
  });

  it("surfaces unparseable data as a raw string rather than throwing", async () => {
    const events = await collect(["event: error\ndata: not-json\n\n"]);
    expect(events).toEqual([{ name: "error", data: "not-json" }]);
  });
});
