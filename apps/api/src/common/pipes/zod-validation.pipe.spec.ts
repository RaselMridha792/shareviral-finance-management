import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

import { ZodValidationPipe } from "./zod-validation.pipe";

describe("ZodValidationPipe", () => {
  const schema = z.strictObject({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a money amount"),
    direction: z.enum(["in", "out"]),
    note: z.string().optional(),
  });

  const pipe = new ZodValidationPipe(schema);

  it("returns the parsed value when valid", () => {
    expect(pipe.transform({ amount: "4500.00", direction: "out" })).toEqual({
      amount: "4500.00",
      direction: "out",
    });
  });

  it("rejects unknown keys, the way forbidNonWhitelisted did", () => {
    expect(() =>
      pipe.transform({ amount: "1.00", direction: "in", sneaky: "x" }),
    ).toThrow(BadRequestException);
  });

  it("reports errors keyed by field path", () => {
    try {
      pipe.transform({ amount: "not-money", direction: "sideways" });
      fail("expected a BadRequestException");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        message: string;
        errors: Record<string, string[]>;
      };
      expect(body.message).toBe("Validation failed");
      expect(body.errors.amount).toEqual(["Must be a money amount"]);
      expect(body.errors.direction).toBeDefined();
    }
  });

  it("nests paths with dots so the web form can map them to inputs", () => {
    const nested = new ZodValidationPipe(
      z.object({ vendor: z.object({ etin: z.string().length(12) }) }),
    );
    try {
      nested.transform({ vendor: { etin: "123" } });
      fail("expected a BadRequestException");
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as {
        errors: Record<string, string[]>;
      };
      expect(Object.keys(body.errors)).toEqual(["vendor.etin"]);
    }
  });

  it("coerces query strings when the schema asks it to", () => {
    const query = new ZodValidationPipe(
      z.object({ page: z.coerce.number().int().min(1).default(1) }),
    );
    expect(query.transform({ page: "3" })).toEqual({ page: 3 });
    expect(query.transform({})).toEqual({ page: 1 });
  });
});
