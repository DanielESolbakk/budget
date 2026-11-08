export function writePdfObjects(objects: readonly string[]): Buffer {
  if (objects.length === 0) {
    throw new Error("A synthetic PDF must contain at least one object.");
  }
  const chunks = [Buffer.from("%PDF-1.4\n", "ascii")];
  const offsets: number[] = [];
  let byteLength = chunks[0]!.length;
  for (const [index, object] of objects.entries()) {
    offsets.push(byteLength);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "utf8");
    chunks.push(chunk);
    byteLength += chunk.length;
  }
  const xref = offsets.map((offset) => `${offset.toString().padStart(10, "0")} 00000 n \n`).join("");
  chunks.push(Buffer.from(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${byteLength}\n%%EOF`,
    "ascii"
  ));
  return Buffer.concat(chunks);
}
