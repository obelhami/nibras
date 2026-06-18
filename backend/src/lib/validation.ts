// Validate name/status/dates

export function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
  
  // Validate dates
  export function isValidDateString(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
  }
  
  export function isValidDateRange(startDate: string | null, endDate: string | null): boolean {
    if (!startDate || !endDate) return true;
    return new Date(startDate).getTime() <= new Date(endDate).getTime();
  }