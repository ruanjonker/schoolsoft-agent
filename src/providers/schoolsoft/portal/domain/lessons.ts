/**
 * `GET /rest-api/parent/calendar/lessons/week/<w>` (app cookies): the child in
 * focus's lessons for one week. Field names recorded live 2026-09-06; value
 * formats are assumed (see the typed-domain-model spec).
 */
import { z } from "zod";
import type { Lesson } from "../../../../core/domain/schemas.js";
import { dateTime, optionalText, parseUpstream, upstreamId } from "./parse.js";

const rawLessons = z.array(
  z.object({
    eventId: upstreamId,
    name: z.string(),
    startDate: dateTime,
    endDate: dateTime,
    room: optionalText,
    teachingGroup: optionalText,
    teacher: optionalText,
    description: optionalText,
    // Names seen in community clients and the app, not re-checked live.
    cancelled: z.boolean().optional(),
    changed: z.boolean().optional(),
    isCancelled: z.boolean().optional(),
    isChanged: z.boolean().optional(),
    // Live (2026-10-14, web session): a number (-1 or 2 seen), meaning not
    // known; only a text status is read for cancellations and changes.
    status: z.union([z.string(), z.number()]).nullish(),
  }),
);

function lessonStatus(l: {
  cancelled?: boolean;
  changed?: boolean;
  isCancelled?: boolean;
  isChanged?: boolean;
  status?: string | number | null;
}): "scheduled" | "cancelled" | "changed" {
  const text = typeof l.status === "string" ? l.status.toLowerCase() : "";
  if (l.cancelled === true || l.isCancelled === true || /cancel|inställd/.test(text))
    return "cancelled";
  if (l.changed === true || l.isChanged === true || /chang|ändr/.test(text)) return "changed";
  return "scheduled";
}

export function toLessons(data: unknown): Lesson[] {
  return parseUpstream(rawLessons, data, "getScheduleWeek").map((l) => ({
    // A recurring event id is not known to be unique per occurrence; the start is.
    id: `lesson:${l.eventId}@${l.startDate}`,
    title: l.name,
    start: l.startDate,
    end: l.endDate,
    room: l.room,
    group: l.teachingGroup,
    teacher: l.teacher,
    note: l.description,
    status: lessonStatus(l),
  }));
}
