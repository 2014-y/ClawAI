function readDatePart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatBusinessDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return `${readDatePart(parts, "year")}-${readDatePart(parts, "month")}-${readDatePart(parts, "day")}`;
}

export function isoTimestampFromMillis(timestamp: number | undefined): string {
  return new Date(
    typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : Date.now(),
  ).toISOString();
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolveIsoWeekRange(businessDate: string): {
  weekStartDate: string;
  weekEndDate: string;
} {
  const parsed = new Date(`${businessDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return { weekStartDate: businessDate, weekEndDate: businessDate };
  }
  const day = parsed.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(parsed, mondayOffset);
  const sunday = addDays(monday, 6);
  return {
    weekStartDate: formatUtcDate(monday),
    weekEndDate: formatUtcDate(sunday),
  };
}
