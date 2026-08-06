import { z } from "zod";

export const NarrationFocusTargetSchema = z.object({
  narrationText: z.string().min(1).max(1_000),
  anchors: z.array(z.string().min(1).max(300)).min(1).max(8),
  targetTextIds: z.array(z.string().min(1).max(120)).max(12).default([]),
  mode: z.enum(["text", "container"]).default("text")
}).strict();

export const SpeechScriptPlanSchema = z.object({
  scriptText: z.string().min(1).max(4_000),
  focusTargets: z.array(NarrationFocusTargetSchema).max(16).default([])
}).strict();

export const NarrationFocusPlanSchema = z.object({
  version: z.literal(1),
  svgHash: z.string().regex(/^[a-f0-9]{64}$/i),
  targets: z.array(NarrationFocusTargetSchema).max(16)
}).strict();

export const NarrationAlignmentCueSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string().min(1).max(4_000),
  focusTargetIndexes: z.array(z.number().int().nonnegative()).max(16).default([])
}).strict().refine((cue) => cue.endMs > cue.startMs, {
  message: "alignment cue endMs must be greater than startMs"
});

export const NarrationAlignmentSchema = z.object({
  version: z.literal(1),
  audioDurationMs: z.number().int().positive(),
  source: z.enum(["transcript", "audio-silence", "page"]),
  quality: z.object({
    coverage: z.number().min(0).max(1),
    meanConfidence: z.number().min(0).max(1).optional()
  }).strict().optional(),
  cues: z.array(NarrationAlignmentCueSchema).min(1)
}).strict().superRefine((alignment, context) => {
  if (alignment.source === "transcript" && !alignment.quality) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "transcript alignment requires quality metrics", path: ["quality"] });
  }
  if (alignment.cues[0]?.startMs !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "alignment must start at 0", path: ["cues", 0, "startMs"] });
  }
  for (let index = 1; index < alignment.cues.length; index += 1) {
    if (alignment.cues[index]?.startMs !== alignment.cues[index - 1]?.endMs) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "alignment cues must be contiguous", path: ["cues", index, "startMs"] });
    }
  }
  if (alignment.cues.at(-1)?.endMs !== alignment.audioDurationMs) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "alignment must end at audioDurationMs", path: ["cues"] });
  }
});

export type NarrationFocusTarget = z.infer<typeof NarrationFocusTargetSchema>;
export type SpeechScriptPlan = z.infer<typeof SpeechScriptPlanSchema>;
export type NarrationFocusPlan = z.infer<typeof NarrationFocusPlanSchema>;
export type NarrationAlignmentCue = z.infer<typeof NarrationAlignmentCueSchema>;
export type NarrationAlignment = z.infer<typeof NarrationAlignmentSchema>;
