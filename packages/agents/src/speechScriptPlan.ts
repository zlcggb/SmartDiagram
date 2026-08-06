import {
  SpeechScriptPlanSchema,
  type NarrationFocusTarget,
  type SpeechScriptPlan
} from "@ppt-agent/shared";
import type { VisibleTextCandidateRef } from "./types.js";

export const speechScriptPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scriptText: { type: "string" },
    focusTargets: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          narrationText: { type: "string" },
          anchors: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
          targetTextIds: { type: "array", maxItems: 12, items: { type: "string" } },
          mode: { type: "string", enum: ["text", "container"] }
        },
        required: ["narrationText", "anchors", "targetTextIds", "mode"]
      }
    }
  },
  required: ["scriptText", "focusTargets"]
} as const;

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function sentenceForAnchor(scriptText: string, anchor: string) {
  return scriptText
    .split(/(?<=[。！？!?；;])/u)
    .map((part) => part.trim())
    .find((part) => normalized(part).includes(normalized(anchor))) ?? scriptText;
}

export function buildSafeFocusTargets(scriptText: string, candidates: VisibleTextCandidateRef[]): NarrationFocusTarget[] {
  const normalizedScript = normalized(scriptText);
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      const value = normalized(candidate.text);
      return value.length >= 2 && normalizedScript.includes(value);
    })
    .filter((candidate) => {
      const key = normalized(candidate.text);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12)
    .map((candidate) => ({
      narrationText: sentenceForAnchor(scriptText, candidate.text),
      anchors: [candidate.text],
      targetTextIds: [candidate.id],
      mode: "text" as const
    }));
}

export function normalizeSpeechScriptPlan(value: unknown, candidates: VisibleTextCandidateRef[], fallbackScript = ""): SpeechScriptPlan {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const parsed = SpeechScriptPlanSchema.safeParse(value);
  const scriptText = parsed.success ? parsed.data.scriptText : fallbackScript.trim();
  if (!scriptText) throw new Error("演讲稿计划缺少 scriptText");

  const targets = parsed.success
    ? parsed.data.focusTargets.flatMap((target) => {
        const ids = target.targetTextIds.filter((id) => candidateById.has(id));
        const exactCandidates = candidates.filter((candidate) =>
          target.anchors.some((anchor) => normalized(anchor) === normalized(candidate.text))
        );
        const resolvedIds = [...new Set([...ids, ...exactCandidates.map((candidate) => candidate.id)])];
        if (!resolvedIds.length || !normalized(scriptText).includes(normalized(target.narrationText))) return [];
        // SVG V1 only has audited text geometry. Keep model-selected container
        // semantics from silently masquerading as a text box until container
        // shape extraction and QA are implemented.
        return [{ ...target, targetTextIds: resolvedIds, mode: "text" as const }];
      })
    : [];

  return SpeechScriptPlanSchema.parse({
    scriptText,
    focusTargets: targets.length ? targets : buildSafeFocusTargets(scriptText, candidates)
  });
}
