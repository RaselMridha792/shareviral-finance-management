import {
  BadRequestException,
  Body,
  Param,
  PipeTransform,
  Query,
} from "@nestjs/common";
import type { ZodType } from "zod";

export type FieldErrors = Record<string, string[]>;

/**
 * Validates and coerces a request payload against a Zod schema.
 *
 * Zod is the single source of truth for shapes in this codebase: the same
 * schema in `@finance/shared` validates the API, drives the web form, and
 * generates the AI intake's structured-output JSON Schema. class-validator
 * would mean a second definition that silently drifts from the first.
 *
 * Use `z.strictObject()` in the schema to reject unknown keys — that's the
 * equivalent of class-validator's `forbidNonWhitelisted`.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const fieldErrors: FieldErrors = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length ? issue.path.join(".") : "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }

    throw new BadRequestException({
      message: "Validation failed",
      errors: fieldErrors,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Parameter decorators                                                       */
/* -------------------------------------------------------------------------- */

/** `@ZodBody(createTransactionSchema) body: CreateTransactionInput` */
export const ZodBody = <T>(schema: ZodType<T>) =>
  Body(new ZodValidationPipe(schema));

/** Query strings arrive as text — use `z.coerce` in the schema for numbers. */
export const ZodQuery = <T>(schema: ZodType<T>) =>
  Query(new ZodValidationPipe(schema));

export const ZodParam = <T>(schema: ZodType<T>) =>
  Param(new ZodValidationPipe(schema));
