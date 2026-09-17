export type TaskStatus =
  | 'ready' | 'queued' | 'planning' | 'waiting_input' | 'executing' | 'blocked'
  | 'testing' | 'awaiting_confirm' | 'interrupted' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface Board {
  id: string; name: string; created_at: number;
  total: number; active: number; done: number;
  last: { board_id: string; title: string; priority: number } | null;
}

export interface PlanStep { id: string; title: string; goal: string; actions: string[]; done: boolean; }
export interface BranchQ { id: string; q: string; options: { label: string; recommended?: boolean }[]; default: string; }
export interface Plan {
  summary: string; steps: PlanStep[]; branch_questions: BranchQ[]; acceptance: string[]; test_cmd?: string;
}
export interface ReviewItem { criterion: string; pass: boolean; evidence: string; }
export interface Review { items: ReviewItem[]; overall: 'pass' | 'fail'; retriesLeft: number; }

export interface Task {
  id: string; board_id: string; num: number; title: string; description: string;
  priority: number; status: TaskStatus; created_at: number; started_at: number | null; finished_at: number | null;
  workspace_path: string; branch_mode: 'manual' | 'auto'; branch_timeout_min: number;
  acceptance_text: string; test_cmd: string; extra_prompt: string; retry_count: number;
  current_action: string; context_window?: number;
  board_name?: string; subagent?: { label: string; at: number; id: string | null } | null;
  plan: Plan | null; answers: Record<string, string>; review: Review | null;
}

export interface BlockItem {
  id: number; task_id: string; question: string;
  context: { current: string; verified: string; impact: string; refs: string[] };
  options: { label: string; pros?: string; cons?: string; estimate?: string }[];
  recommended: string; answer: string | null; asked_at: number; answered_at: number | null; status: string;
}

export interface TaskEvent { seq: number; ts: number; kind: string; payload: any; }

export interface Asset { id: number; kind: string; name: string; path_or_url: string; summary: string; at: number; }

export interface SkillItem { name: string; description: string; path: string; source: string; kind: 'skill' | 'extension'; }
export interface SkillsInv {
  global: { skills: SkillItem[]; extensions: SkillItem[] };
  projects: { dir: string; skills: SkillItem[]; extensions: SkillItem[] }[];
  tasks: Record<string, { title: string; boardId: string; items: (SkillItem & { id: number })[] }>;
}

export interface Settings {
  concurrency: number; branchTimeoutMin: number; retryMax: number;
  endpoint: string; provider: string; execModel: string; planMaxTokens: number;
  workspacesBase: string; systemPrompt: string; promptUpdatedAt: number | null;
}

export interface Runtime { used: number; total: number; queue: number; paused?: number; waiting: number; blocked: number; awaiting: number; }
export interface Project { name: string; paths: string[]; tasks: number; active: number; }
