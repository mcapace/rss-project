import "server-only";
import { cmsDb, databaseError } from "./db";
import { CmsError, type CmsUser } from "./access";
import { isUuid } from "./validation";
import type { CmsDocument } from "./types";

export async function getCmsDocument(id: string, user: CmsUser): Promise<CmsDocument> {
  if (!isUuid(id)) throw new CmsError(404, "Document not found.");
  const { data, error } = await cmsDb().from("cms_documents").select("*").eq("id", id).in("brand", user.brands).maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new CmsError(404, "Document not found.");
  return data as CmsDocument;
}
