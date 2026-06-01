import { describe, expect, it } from "vitest";
import {
  extractTextSurface,
  applyTextOverrides,
} from "./flowTemplateInstaller.service";

const baseDef = {
  nodes: [
    {
      id: "trigger_1",
      type: "TRIGGER",
      next: "msg_1",
      position: { x: 0, y: 0 },
      data: { keywords: ["hi"] },
    },
    {
      id: "msg_1",
      type: "MESSAGE",
      next: "ask_1",
      position: { x: 240, y: 0 },
      data: { text: "Welcome to our shop!" },
    },
    {
      id: "ask_1",
      type: "QUESTION",
      position: { x: 480, y: 0 },
      data: { question: "What can I help you with?" },
    },
    {
      id: "noop_1",
      type: "DELAY",
      position: { x: 720, y: 0 },
      data: { hours: 2 },
    },
  ],
  edges: [],
};

describe("extractTextSurface", () => {
  it("picks up only text-bearing fields", () => {
    const surface = extractTextSurface(baseDef);
    expect(surface).toEqual({
      msg_1: { text: "Welcome to our shop!" },
      ask_1: { question: "What can I help you with?" },
    });
    expect("trigger_1" in surface).toBe(false);
    expect("noop_1" in surface).toBe(false);
  });

  it("ignores empty / whitespace string fields", () => {
    const def = {
      nodes: [
        {
          id: "n1",
          type: "MESSAGE",
          position: { x: 0, y: 0 },
          data: { text: "   " },
        },
      ],
    };
    expect(extractTextSurface(def)).toEqual({});
  });

  it("returns empty for a template with no text nodes", () => {
    const def = {
      nodes: [
        {
          id: "n1",
          type: "DELAY",
          position: { x: 0, y: 0 },
          data: { hours: 2 },
        },
      ],
    };
    expect(extractTextSurface(def)).toEqual({});
  });
});

describe("applyTextOverrides", () => {
  it("rewrites a single field and preserves everything else", () => {
    const out = applyTextOverrides(baseDef, {
      msg_1: { text: "Welcome to Acme Salon — ready for your booking?" },
    });
    expect(out.nodes[1].data?.text).toBe(
      "Welcome to Acme Salon — ready for your booking?",
    );
    // Graph structure unchanged
    expect(out.nodes.map((n) => n.id)).toEqual([
      "trigger_1",
      "msg_1",
      "ask_1",
      "noop_1",
    ]);
    expect(out.nodes[1].type).toBe("MESSAGE");
    expect(out.nodes[1].next).toBe("ask_1");
    expect(out.nodes[1].position).toEqual({ x: 240, y: 0 });
  });

  it("drops overrides keyed by an invented node id", () => {
    const out = applyTextOverrides(baseDef, {
      ghost_42: { text: "I made this id up" },
      msg_1: { text: "Real change" },
    });
    expect(out.nodes[1].data?.text).toBe("Real change");
    // No new nodes added
    expect(out.nodes.length).toBe(4);
  });

  it("ignores empty string / whitespace overrides (preserves original)", () => {
    const out = applyTextOverrides(baseDef, {
      msg_1: { text: "   " },
    });
    expect(out.nodes[1].data?.text).toBe("Welcome to our shop!");
  });

  it("clamps any single field at 1024 chars to bound runaway output", () => {
    const long = "x".repeat(2000);
    const out = applyTextOverrides(baseDef, { msg_1: { text: long } });
    expect((out.nodes[1].data?.text as string).length).toBe(1024);
  });

  it("can rewrite multiple fields on the same node", () => {
    // QUESTION node has `question`; if a template also stored `text`
    // on the same node, both should be rewritable.
    const def = {
      nodes: [
        {
          id: "q1",
          type: "QUESTION",
          position: { x: 0, y: 0 },
          data: { question: "Old q?", text: "Old text" },
        },
      ],
    };
    const out = applyTextOverrides(def, {
      q1: { question: "New q?", text: "New text" },
    });
    expect(out.nodes[0].data?.question).toBe("New q?");
    expect(out.nodes[0].data?.text).toBe("New text");
  });

  it("leaves nodes untouched when no override is supplied for them", () => {
    const out = applyTextOverrides(baseDef, {
      msg_1: { text: "Updated" },
    });
    expect(out.nodes[2].data?.question).toBe("What can I help you with?");
    expect(out.nodes[3].data?.hours).toBe(2);
  });

  it("CANNOT change a node's type / id / position / edges", () => {
    // Even if the LLM somehow tries to slip these through via the
    // `data` map, the applyTextOverrides function copies only the
    // rewritable fields back. Verify by checking that an attempted
    // type-rewrite (which lives outside REWRITABLE_FIELDS) doesn't
    // land.
    const out = applyTextOverrides(baseDef, {
      msg_1: {
        text: "Real text",
        // these keys aren't in REWRITABLE_FIELDS, so they're dropped
        ...({ type: "EVIL", id: "evil", next: "ghost" } as Record<string, string>),
      } as never,
    });
    expect(out.nodes[1].type).toBe("MESSAGE");
    expect(out.nodes[1].id).toBe("msg_1");
    expect(out.nodes[1].next).toBe("ask_1");
  });

  it("preserves edges array reference", () => {
    const out = applyTextOverrides(baseDef, { msg_1: { text: "x" } });
    expect(out.edges).toBe(baseDef.edges);
  });

  it("returns a new object (does not mutate input)", () => {
    const out = applyTextOverrides(baseDef, { msg_1: { text: "new" } });
    expect(out).not.toBe(baseDef);
    // Original untouched
    expect(baseDef.nodes[1].data?.text).toBe("Welcome to our shop!");
  });
});
