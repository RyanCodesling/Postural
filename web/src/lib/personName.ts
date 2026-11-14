/**
 * Person names (first, middle, last) may not contain digits. The admin forms
 * drop digits as they are typed; the users API rejects any that get through.
 */
const DIGITS = /\d/g;

export function stripNameDigits(value: string): string {
  return value.replace(DIGITS, "");
}

/** The first name field ("First Name", ...) holding a digit, or null if none do. */
export function nameFieldWithDigits(
  fields: { firstName?: unknown; middleName?: unknown; lastName?: unknown },
): string | null {
  const labels = { firstName: "First Name", middleName: "Middle Name", lastName: "Last Name" } as const;
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
    const value = fields[key];
    if (typeof value === "number" || (typeof value === "string" && /\d/.test(value))) return labels[key];
  }
  return null;
}
