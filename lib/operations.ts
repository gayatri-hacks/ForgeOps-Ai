import { BomItem, Component, Milestone, PurchaseOrder, RegulatoryDocument, Risk, WorkCenter } from "./types";

const day = (date: string) => new Date(`${date}T00:00:00`).getTime();
const now = () => new Date().toISOString();

export function shortage(item: BomItem, component: Component, pos: PurchaseOrder[]) {
  const inbound = pos.filter(p => p.componentCode === item.componentCode && p.status === "open" && day(p.committedDate) <= day(item.assemblyDate)).reduce((sum, p) => sum + p.quantity, 0);
  return { onHand: component.onHand, inbound, available: component.onHand + inbound, shortage: Math.max(0, item.required - component.onHand - inbound) };
}

export function assertAcyclic(milestones: Milestone[]) {
  const map = new Map(milestones.map(x => [x.id, x])); const done = new Set<string>(); const active = new Set<string>();
  const visit = (id: string): void => { if (active.has(id)) throw new Error(`Circular milestone dependency: ${id}`); if (done.has(id)) return; active.add(id); (map.get(id)?.dependsOn || []).forEach(visit); active.delete(id); done.add(id); };
  milestones.forEach(x => visit(x.id));
}

export function downstream(start: string, milestones: Milestone[]) {
  const answer: string[] = []; const walk = (id: string) => milestones.filter(m => m.dependsOn.includes(id)).forEach(m => { answer.push(m.id); walk(m.id); }); walk(start); return answer;
}

export function detectRisks(args: { items: BomItem[]; components: Component[]; pos: PurchaseOrder[]; milestones: Milestone[]; centers: WorkCenter[]; docs: RegulatoryDocument[] }): Risk[] {
  const { items, components, pos, milestones, centers, docs } = args; const out: Risk[] = [];
  const add = (risk: Omit<Risk, "id" | "fingerprint" | "detectedAt" | "status">) => {
    const fingerprint = [risk.source, risk.programmeId, risk.milestoneId || "", risk.title].join(":");
    out.push({ ...risk, id: `RSK-${String(out.length + 1).padStart(3, "0")}`, fingerprint, status: "open", detectedAt: now() });
  };
  items.forEach(item => {
    const component = components.find(c => c.code === item.componentCode)!; const material = shortage(item, component, pos);
    const milestone = milestones.find(m => m.programmeId === item.programmeId && m.materialComponentCode === item.componentCode);
    if (material.shortage > 0) {
      const evidence = [component.code, ...pos.filter(p => p.componentCode === component.code).map(p => p.id)];
      add({ source: "Material", severity: "critical", programmeId: item.programmeId, milestoneId: milestone?.id, title: `${component.code} shortage blocks build`, trigger: `Required ${item.required}; only ${material.available} available by ${item.assemblyDate}; short ${material.shortage}.`, action: "Expedite supply or approve alternate source; rebaseline dependent milestones.", owner: milestone?.owner || "Supply Chain", targetDate: item.assemblyDate, evidence });
      if (milestone) downstream(milestone.id, milestones).forEach(id => {
        const successor = milestones.find(m => m.id === id)!;
        add({ source: "Schedule", severity: "high", programmeId: item.programmeId, milestoneId: successor.id, title: `Dependency exposure: ${successor.name}`, trigger: `${milestone.name} is blocked by ${component.code} shortage; this finish-to-start successor cannot start on plan.`, action: "Escalate in the programme review; rebaseline after material recovery is confirmed.", owner: successor.owner, targetDate: successor.dueDate, evidence: [milestone.id, ...evidence] });
      });
    } else if (pos.some(p => p.componentCode === item.componentCode && p.status === "open" && day(p.committedDate) > day(item.assemblyDate))) {
      add({ source: "Material", severity: "high", programmeId: item.programmeId, milestoneId: milestone?.id, title: `Late commitment for ${component.code}`, trigger: `Open PO lands after assembly date ${item.assemblyDate}.`, action: "Confirm vendor recovery plan and reserve available inventory.", owner: "Supply Chain", targetDate: item.assemblyDate, evidence: pos.filter(p => p.componentCode === component.code).map(p => p.id) });
    }
  });
  centers.filter(c => c.plannedHours > c.weeklyHours).forEach(c => add({ source: "Capacity", severity: "high", programmeId: c.programmeId, title: `${c.name} is overbooked`, trigger: `${c.plannedHours} planned hours versus ${c.weeklyHours} available hours.`, action: "Move work, authorize overtime, or adjust customer commitment.", owner: "Manufacturing", targetDate: new Date().toISOString().slice(0, 10), evidence: [c.name] }));
  docs.filter(d => d.status !== "approved" && day(d.approvalDue) - Date.now() < 7 * 864e5).forEach(d => add({ source: "Regulatory", severity: "high", programmeId: d.programmeId, title: `Approval due: ${d.title}`, trigger: `Document owner approval due ${d.approvalDue}.`, action: "Complete review and record approval decision.", owner: d.owner, targetDate: d.approvalDue, evidence: [d.id] }));
  return out;
}
