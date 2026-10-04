/** Tiny helpers for strict JSON Schemas used with constrained decoding. */

type Schema = Record<string, unknown>;

export const str = (maxLength = 300): Schema => ({ type: "string", maxLength });
export const nullableStr = (maxLength = 300): Schema => ({ type: ["string", "null"], maxLength });
export const num: Schema = { type: "number" };
export const nullableNum: Schema = { type: ["number", "null"] };
export const bool: Schema = { type: "boolean" };
export const enumOf = (values: readonly string[]): Schema => ({ type: "string", enum: [...values] });
export const nullableEnum = (values: readonly string[]): Schema => ({ type: ["string", "null"], enum: [...values, null] });
export const arr = (items: Schema, maxItems = 20): Schema => ({ type: "array", items, maxItems });

/** Object with every property required and no extras (strict mode). */
export const obj = (properties: Record<string, Schema>): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
