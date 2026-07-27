export type BoundedTextAppendResult = {
  text: string;
  truncated: boolean;
};

export function getUtf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function removeLeadingLowSurrogate(value: string): string {
  if (!value) {
    return value;
  }
  const firstCodeUnit = value.charCodeAt(0);
  return firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff
    ? value.slice(1)
    : value;
}

export function trimUtf8TextStartToMaxBytes(value: string, maxBytes: number): BoundedTextAppendResult {
  if (maxBytes <= 0) {
    return {
      text: "",
      truncated: value.length > 0,
    };
  }

  if (getUtf8ByteLength(value) <= maxBytes) {
    return { text: value, truncated: false };
  }

  let text = value;
  while (text && getUtf8ByteLength(text) > maxBytes) {
    const overflowBytes = getUtf8ByteLength(text) - maxBytes;
    const charsToDrop = Math.max(1, Math.ceil(overflowBytes / 4));
    text = removeLeadingLowSurrogate(text.slice(charsToDrop));
  }

  return {
    text,
    truncated: text !== value,
  };
}

export function appendBoundedUtf8Text(
  current: string,
  chunk: string,
  maxBytes: number
): BoundedTextAppendResult {
  if (maxBytes <= 0) {
    return {
      text: "",
      truncated: current.length > 0 || chunk.length > 0,
    };
  }

  const boundedChunk = trimUtf8TextStartToMaxBytes(chunk, maxBytes);
  if (boundedChunk.truncated) {
    return {
      text: boundedChunk.text,
      truncated: true,
    };
  }

  const remainingBytes = maxBytes - getUtf8ByteLength(boundedChunk.text);
  const boundedCurrent = trimUtf8TextStartToMaxBytes(current, remainingBytes);
  return {
    text: `${boundedCurrent.text}${boundedChunk.text}`,
    truncated: boundedCurrent.truncated,
  };
}
