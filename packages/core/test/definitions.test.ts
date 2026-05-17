import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, HephError } from "../src/index.js";

describe("defineTool", () => {
  it("keeps Zod validation and exposes a JSON schema snapshot", () => {
    const tool = defineTool({
      id: "search-docs",
      description: "Search docs.",
      inputSchema: z.object({
        query: z.string()
      }),
      execute(input) {
        return input.query;
      }
    });

    expect(tool.jsonSchema).toMatchObject({
      type: "object"
    });
    expect(tool.inputSchema.parse({ query: "heph" })).toEqual({ query: "heph" });
  });

  it("fails fast when a schema cannot be represented as JSON Schema", () => {
    expect(() =>
      defineTool({
        id: "bad-tool",
        description: "Bad tool.",
        inputSchema: z.object({
          value: z.string().transform((value) => value.trim())
        }),
        execute(input) {
          return input.value;
        }
      })
    ).toThrowError(HephError);

    try {
      defineTool({
        id: "bad-tool",
        description: "Bad tool.",
        inputSchema: z.object({
          value: z.string().transform((value) => value.trim())
        }),
        execute(input) {
          return input.value;
        }
      });
    } catch (error) {
      expect(error).toBeInstanceOf(HephError);
      expect((error as HephError).code).toBe("HEPH3001");
    }
  });
});
