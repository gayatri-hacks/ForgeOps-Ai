import { detectRisks } from "./operations";
import { getRepository } from "./repository";

export async function data() {
  const persisted = await getRepository().load();
  return { ...persisted, risks: detectRisks({ items: persisted.bomItems, components: persisted.components, pos: persisted.pos, milestones: persisted.milestones, centers: persisted.workCenters, docs: persisted.documents }) };
}

export async function updateCommitment(poId: string, committedDate: string) { await getRepository().updateCommitment(poId, committedDate); return data(); }

export async function dashboard() {
  const d = await data(); const open = d.risks.filter(r => r.status === "open"); const delayed = new Set(open.filter(r => r.milestoneId).map(r => r.milestoneId));
  return { metrics: { activeProgrammes: d.programmes.length, atRiskProgrammes: new Set(open.map(r => r.programmeId)).size, criticalRisks: open.filter(r => r.severity === "critical").length, openPOs: d.pos.filter(p => p.status === "open").length, onTimeMilestones: d.milestones.filter(m => !delayed.has(m.id)).length, capacityUtilization: Math.round(d.workCenters.reduce((n, c) => n + c.plannedHours, 0) / d.workCenters.reduce((n, c) => n + c.weeklyHours, 0) * 100) }, ...d, openRisks: open };
}
