export function formatTruncatedCode(value: string, maxVisible = 10) {
  if (value.length <= maxVisible) {
    return value;
  }

  return `…${value.slice(-maxVisible)}`;
}
