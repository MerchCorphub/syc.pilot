import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Deletes scan photos older than 120 days from the scan-photos bucket.
// Scan records are kept; each photo row is stamped with photo_deleted_at.
// Called every 30 days by the database job "syc-photo-purge-check".
const RETENTION_DAYS = 120;
const BATCH = 500;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const key = req.headers.get("x-purge-key") ?? "";
  const { data: ok, error: keyErr } = await supabase.rpc("verify_purge_key", { p_key: key });
  if (keyErr || ok !== true) return json({ error: "not allowed" }, 401);

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
  let deleted = 0;

  for (let i = 0; i < 200; i++) {
    const { data: rows, error } = await supabase
      .from("scan_photos")
      .select("id, storage_path")
      .lt("created_at", cutoff)
      .is("photo_deleted_at", null)
      .limit(BATCH);
    if (error) return json({ error: error.message, deleted }, 500);
    if (!rows || rows.length === 0) break;

    const { error: rmErr } = await supabase.storage
      .from("scan-photos")
      .remove(rows.map((r) => r.storage_path));
    if (rmErr) return json({ error: rmErr.message, deleted }, 500);

    const { error: upErr } = await supabase
      .from("scan_photos")
      .update({ photo_deleted_at: new Date().toISOString() })
      .in("id", rows.map((r) => r.id));
    if (upErr) return json({ error: upErr.message, deleted }, 500);

    deleted += rows.length;
  }

  return json({ deleted, cutoff });
});
