import { requireAuth } from "@/lib/session";
import { runMigrations } from "@/lib/migrations";
import { streamOperation } from "@/lib/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    await requireAuth();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return streamOperation(async (onProgress) => {
    const { count } = await runMigrations(onProgress);
    return { summary: `${count} migration(s) applied` };
  });
}
