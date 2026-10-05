export function record(value: unknown, name = "value"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  return value;
}

export function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : string(value, name);
}

export function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe JSON integer`);
  }
  return value;
}

export function decimal(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^(?:0|-?[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${name} must be a canonical decimal string`);
  }
  return BigInt(value);
}

export function optionalDecimal(value: unknown, name: string): bigint | undefined {
  return value === undefined ? undefined : decimal(value, name);
}

export function array<T>(
  value: unknown,
  name: string,
  parse: (entry: unknown, name: string) => T,
): T[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value.map((entry, index) => parse(entry, `${name}[${index}]`));
}

export function stringArray(value: unknown, name: string): string[] {
  return array(value, name, string);
}
