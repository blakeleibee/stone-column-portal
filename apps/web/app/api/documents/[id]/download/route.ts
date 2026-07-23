import { NextResponse } from "next/server";
import { canViewDocument } from "../../../../../src/server/auth/can";
import { createServerSupabaseClient } from "../../../../../src/server/supabase/serverClient";
import { getStorageAdapter } from "../../../../../src/server/storage/getStorageAdapter";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const allowed = await canViewDocument(id);
  if (!allowed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: doc, error } = await supabase.from("documents").select("storage_key, file_name, mime_type").eq("id", id).single();
  if (error || !doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const adapter = getStorageAdapter();
  const url = await adapter.getDownloadUrl(doc.storage_key);
  return NextResponse.redirect(new URL(url, "http://localhost"));
}
