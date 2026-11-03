/** "30. 10. 2026" for an iVysílání broadcast date. */
export function ctDate(iso?: string): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? undefined : `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`
}
