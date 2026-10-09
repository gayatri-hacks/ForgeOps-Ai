import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { bomItems, components, documents, initialPOs, milestones, programmes, workCenters } from "./seed";
import { BomItem, Component, Milestone, Programme, PurchaseOrder, RegulatoryDocument, WorkCenter } from "./types";

export type OperationalData = { programmes: Programme[]; components: Component[]; bomItems: BomItem[]; milestones: Milestone[]; pos: PurchaseOrder[]; workCenters: WorkCenter[]; documents: RegulatoryDocument[] };
export type OperationalRepository = { load(): Promise<OperationalData>; updateCommitment(poId: string, committedDate: string): Promise<void> };
export class RepositoryConfigurationError extends Error { }
export class RepositoryError extends Error { }

class DemoRepository implements OperationalRepository {
  private pos = [...initialPOs];
  async load(): Promise<OperationalData> { return { programmes, components, bomItems, milestones, pos: this.pos, workCenters, documents }; }
  async updateCommitment(poId: string, committedDate: string) { const po = this.pos.find(x => x.id === poId); if (!po) throw new RepositoryError("Purchase order not found"); po.committedDate = committedDate; }
}
type Row = Record<string, unknown>;
const string = (row: Row, key: string) => String(row[key] ?? "");
const rows = <T extends Row>(result: { data: T[] | null; error: { message: string } | null }, label: string) => { if (result.error) throw new RepositoryError(`${label}: ${result.error.message}`); return result.data ?? []; };

class SupabaseRepository implements OperationalRepository {
  constructor(private db: SupabaseClient) { }
  async load(): Promise<OperationalData> {
    const [programmeRows, componentRows, bomRows, milestoneRows, dependencyRows, poRows, poItemRows, centerRows, documentRows] = await Promise.all([
      this.db.from("programmes").select("id,name,owner,status,priority,target_date,completion_percent"), this.db.from("components").select("code,name,supplier_id,lead_time_days,on_hand,reorder_point"), this.db.from("bom_items").select("programme_id,component_code,required_quantity,assembly_date"), this.db.from("milestones").select("id,programme_id,name,owner,due_date,duration_days,status,material_component_code"), this.db.from("milestone_dependencies").select("milestone_id,depends_on_id"), this.db.from("purchase_orders").select("id,supplier_id,status,committed_date"), this.db.from("purchase_order_items").select("po_id,component_code,quantity"), this.db.from("work_centers").select("name,weekly_hours,planned_hours,programme_id"), this.db.from("regulatory_documents").select("id,programme_id,title,owner,approval_due,status")
    ]);
    const programmes = rows(programmeRows, "programmes").map(r => ({ id: string(r, "id"), name: string(r, "name"), owner: string(r, "owner"), status: string(r, "status") as Programme["status"], priority: string(r, "priority") as Programme["priority"], targetDate: string(r, "target_date"), completion: Number(r.completion_percent) }));
    const components = rows(componentRows, "components").map(r => ({ code: string(r, "code"), name: string(r, "name"), supplierId: string(r, "supplier_id"), leadDays: Number(r.lead_time_days), onHand: Number(r.on_hand), reorderPoint: Number(r.reorder_point) }));
    const bomItems = rows(bomRows, "bom items").map(r => ({ programmeId: string(r, "programme_id"), componentCode: string(r, "component_code"), required: Number(r.required_quantity), assemblyDate: string(r, "assembly_date") }));
    const dependencies = rows(dependencyRows, "milestone dependencies");
    const milestones = rows(milestoneRows, "milestones").map(r => ({ id: string(r, "id"), programmeId: string(r, "programme_id"), name: string(r, "name"), owner: string(r, "owner"), dueDate: string(r, "due_date"), durationDays: Number(r.duration_days), status: string(r, "status") as Milestone["status"], dependsOn: dependencies.filter(d => d.milestone_id === r.id).map(d => string(d, "depends_on_id")), materialComponentCode: r.material_component_code ? string(r, "material_component_code") : undefined }));
    const poItems = rows(poItemRows, "purchase order items");
    const pos = rows(poRows, "purchase orders").flatMap(r => poItems.filter(item => item.po_id === r.id).map(item => ({ id: string(r, "id"), supplierId: string(r, "supplier_id"), status: string(r, "status") as PurchaseOrder["status"], committedDate: string(r, "committed_date"), componentCode: string(item, "component_code"), quantity: Number(item.quantity) })));
    const workCenters = rows(centerRows, "work centers").map(r => ({ name: string(r, "name"), weeklyHours: Number(r.weekly_hours), plannedHours: Number(r.planned_hours), programmeId: string(r, "programme_id") }));
    const documents = rows(documentRows, "regulatory documents").map(r => ({ id: string(r, "id"), programmeId: string(r, "programme_id"), title: string(r, "title"), owner: string(r, "owner"), approvalDue: string(r, "approval_due"), status: string(r, "status") as RegulatoryDocument["status"] }));
    return { programmes, components, bomItems, milestones, pos, workCenters, documents };
  }
  async updateCommitment(poId: string, committedDate: string) { const result = await this.db.from("purchase_orders").update({ committed_date: committedDate, updated_at: new Date().toISOString() }).eq("id", poId).select("id"); if (result.error) throw new RepositoryError(`purchase order update: ${result.error.message}`); if (!result.data?.length) throw new RepositoryError("Purchase order not found"); }
}

let repository: OperationalRepository | undefined;
export function getRepository(): OperationalRepository {
  if (repository) return repository;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url || key) { if (!url || !key) throw new RepositoryConfigurationError("Both NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for database mode."); repository = new SupabaseRepository(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) } })); return repository; }
  if (process.env.FORGEOPS_DEMO_MODE === "true") { repository = new DemoRepository(); return repository; }
  throw new RepositoryConfigurationError("Database is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or explicitly set FORGEOPS_DEMO_MODE=true for the non-persistent fictional demo.");
}
export function resetRepositoryForTests() { repository = undefined; }
