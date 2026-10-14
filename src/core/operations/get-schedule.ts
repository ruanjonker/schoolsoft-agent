import { z } from "zod";
import { defineOperation, READ_ONLY } from "./types.js";
import { ChildSchema, WeekSchema, withChild, FreshSchema } from "./_shared.js";
import { weekOf, weekOfDate } from "./_week.js";
import { ChildRefSchema, LessonSchema, LocalDateSchema } from "../domain/schemas.js";
import { DAY } from "./_calendar-range.js";

const spanSchema = z
  .number()
  .int()
  .min(1)
  .max(3)
  .optional()
  .describe(
    "How many ISO weeks to return, starting at week. 1 is that week. 3 is that week and the next two (a daily check).",
  );

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export const getSchedule = defineOperation({
  name: "get_schedule",
  title: "Get schedule",
  description: `Get the lesson schedule (timetable) for one child for a given ISO week.

Returns lessons with title, start/end (ISO date-time with the Stockholm offset),
room, teaching group, teacher, note and status (scheduled, cancelled or changed),
and the week's year, Monday and Sunday.

Args:
  - week (number, optional): ISO week 1–53. Defaults to current week; the week
    nearest today is meant (week 2 asked in December is next January's).
  - weeks (number, optional): 1–3 weeks from that week. Default 1. Pass 3 for
    the current week and the next two.
  - child_id (number, optional): from list_children.
  - fresh (boolean, optional): read from SchoolSoft now instead of a recent in-memory copy.

Returns: { year, week, startDate, endDate, spanWeeks, child: { id, firstName }, lessons: [{ id, title, start, end, room, group, teacher, note, status }] }

Use when: "vad har barnet på schemat", "när slutar skolan på fredag", "inställda lektioner de närmaste veckorna".`,
  input: { week: WeekSchema, weeks: spanSchema, child_id: ChildSchema, fresh: FreshSchema },
  output: z.object({
    year: z
      .number()
      .int()
      .describe("ISO week-year: the year in which this week starts nearest today"),
    week: z.number().int().min(1).max(53),
    startDate: LocalDateSchema.describe("Monday of the week, YYYY-MM-DD in Europe/Stockholm"),
    endDate: LocalDateSchema.describe(
      "Sunday of the last week in the span, YYYY-MM-DD in Europe/Stockholm",
    ),
    spanWeeks: z.number().int().min(1).max(3),
    child: ChildRefSchema,
    lessons: z.array(LessonSchema),
  }),
  portal: ["getScheduleWeek"],
  annotations: READ_ONLY,
  async run(ctx, { week, weeks, child_id }) {
    const span = weeks ?? 1;
    const first = weekOf(week);
    const ranges = [first];
    let monday = first.startDate;
    for (let i = 1; i < span; i++) {
      monday = shiftDays(monday, 7);
      ranges.push(weekOfDate(monday));
    }
    const { childRef } = await withChild(ctx, child_id);
    const lessons = [];
    for (const range of ranges) lessons.push(...(await ctx.portal.getScheduleWeek(range.week)));
    const last = ranges[ranges.length - 1];
    return {
      year: first.year,
      week: first.week,
      startDate: first.startDate,
      endDate: last.endDate,
      spanWeeks: span,
      child: childRef,
      lessons,
    };
  },
});
