export type TextPart = { text: string; changed: boolean };
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
function add(parts: TextPart[], text: string, changed: boolean) {
  if (!text) return;
  const last = parts.at(-1);
  if (last?.changed === changed) last.text += text;
  else parts.push({ text, changed });
}
export function highlightText(before: string, after: string) {
  const left: TextPart[] = [],
    right: TextPart[] = [];
  const a = lines(before),
    b = lines(after);
  let start = 0,
    oldEnd = a.length,
    newEnd = b.length;
  while (start < oldEnd && start < newEnd && a[start] === b[start]) start++;
  while (oldEnd > start && newEnd > start && a[oldEnd - 1] === b[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const prefix = a.slice(0, start).join(''),
    suffix = a.slice(oldEnd).join('');
  add(left, prefix, false);
  add(right, prefix, false);
  function changed(x: string, y: string) {
    if (x.replace(/\s/gu, '') === y.replace(/\s/gu, '')) {
      add(left, x, false);
      add(right, y, false);
      return;
    }
    // Bound fine comparison; very long changed blocks are highlighted as complete blocks.
    if (x.length + y.length > 20000) {
      add(left, x, true);
      add(right, y, true);
      return;
    }
    const l = Array.from(x),
      r = Array.from(y);
    const nonWhitespace = (chars: string[]) =>
      chars.flatMap((char, index) => (/\s/u.test(char) ? [] : [index]));
    const li = nonWhitespace(l),
      ri = nonWhitespace(r);
    let head = 0,
      le = li.length,
      re = ri.length;
    while (head < le && head < re && l[li[head]] === r[ri[head]]) head++;
    while (le > head && re > head && l[li[le - 1]] === r[ri[re - 1]]) {
      le--;
      re--;
    }
    function project(
      chars: string[],
      indices: number[],
      end: number,
      output: TextPart[],
    ) {
      let position = 0;
      for (let i = 0; i < chars.length; i++) {
        const significant = indices[position] === i;
        add(
          output,
          chars[i],
          significant && position >= head && position < end,
        );
        if (significant) position++;
      }
    }
    project(l, li, le, left);
    project(r, ri, re, right);
  }
  const height = oldEnd - start + 1,
    width = newEnd - start + 1;
  let coarse = false;
  if (height * width > 250000) {
    coarse = true;
    changed(a.slice(start, oldEnd).join(''), b.slice(start, newEnd).join(''));
  } else {
    const common = new Uint32Array(height * width);
    for (let i = height - 2; i >= 0; i--)
      for (let j = width - 2; j >= 0; j--)
        common[i * width + j] =
          a[start + i] === b[start + j]
            ? 1 + common[(i + 1) * width + j + 1]
            : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);
    let i = start,
      j = start,
      x = '',
      y = '';
    const flush = () => {
      changed(x, y);
      x = '';
      y = '';
    };
    while (i < oldEnd || j < newEnd) {
      if (i < oldEnd && j < newEnd && a[i] === b[j]) {
        flush();
        add(left, a[i++], false);
        add(right, b[j++], false);
      } else if (
        i < oldEnd &&
        (j === newEnd ||
          common[(i - start + 1) * width + j - start] >=
            common[(i - start) * width + j - start + 1])
      )
        x += a[i++];
      else y += b[j++];
    }
    flush();
  }
  add(left, suffix, false);
  add(right, suffix, false);
  return { before: left, after: right, coarse };
}
