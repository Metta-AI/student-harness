import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { importPolicy } from "../../../lib/semantic-ir";

export async function GET() {
  const source = await readFile(join(process.cwd(), "hero.bas"), "utf8");
  return NextResponse.json(importPolicy(source, true));
}
