const TASK_DUE_VALUE_SQL = "COALESCE(dueAt, dueDate)";
const TASK_DUE_PRESENT_SQL = `${TASK_DUE_VALUE_SQL} IS NOT NULL`;

export function taskTodayConditionSql(nowDateSql = "date('now', 'localtime')"): string {
  return `${TASK_DUE_PRESENT_SQL} AND date(${TASK_DUE_VALUE_SQL}) = ${nowDateSql}`;
}

export function taskWeekConditionSql(
  startDateSql = "date('now', 'localtime')",
  endDateSql = "date('now', 'localtime', '+7 days')",
): string {
  return `${TASK_DUE_PRESENT_SQL} AND date(${TASK_DUE_VALUE_SQL}) BETWEEN ${startDateSql} AND ${endDateSql}`;
}

export function taskOverdueConditionSql(nowDateTimeSql = "datetime('now', 'localtime')"): string {
  // dueAt 来自前端时通常是 YYYY-MM-DDTHH:mm；必须转成 SQLite datetime 再比较。
  return `isCompleted = 0 AND ${TASK_DUE_PRESENT_SQL} AND datetime(COALESCE(dueAt, dueDate || 'T23:59:59')) < ${nowDateTimeSql}`;
}
