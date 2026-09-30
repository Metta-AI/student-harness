import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function GET() {
  const source = await readFile(join(process.cwd(), "hero.bas"), "utf8");
  return new Response(source, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": "attachment; filename=hero.bas",
    },
  });
}
